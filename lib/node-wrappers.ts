/**
 * Copyright (c) 2011 Bruno Jouhier <bruno.jouhier@sage.com>
 * MIT License
 */

/// !doc
///
/// # Wrappers for node.js streams
///
/// These wrappers implement a _pull style_ API.
/// For readable streams, instead of having the stream _push_ the data to its consumer by emitting `data` and `end` events,
/// the wrapper lets the consumer _pull_ the data from the stream by calling asynchronous `read` methods.
/// The wrapper takes care of the low level `pause`/`resume` logic.
///
/// Similarly, for writable streams, the wrapper provides a simple asynchronous `write` method and takes
/// care of the low level `drain` logic.
///
/// For more information on this design,
/// see [this blog post](http://bjouhier.wordpress.com/2011/04/25/asynchronous-episode-3-adventures-in-event-land/)
import { run, wait, withContext } from 'f-promise-async';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as os from 'os';
import * as stream from 'stream';
import type { EventEmitter } from 'stream';
import { parse as parseUrl } from 'url';
import * as generic from './devices/generic';
import { Reader } from './reader';
import { Writer } from './writer';

///
/// ## Wrapper
///
/// Base wrapper for all objects that emit an `end` or `close` event.
/// All stream wrappers derive from this wrapper.
///
/// * `wrapper = new streams.Wrapper(stream)`
///   creates a wrapper.

export interface Emitter extends EventEmitter {
    end?: (data?: any, encoding?: string) => void;
    close?: () => void;
    destroySoon?: () => void;
}

function nop() {}

export interface WrapperOptions {
    doesNotEmitClose?: boolean;
}

export class Wrapper<EmitterT extends Emitter> {
    /// * `emitter = wrapper.emitter`
    ///    returns the underlying emitter. The emitter stream can be used to attach additional observers.
    _emitter: EmitterT;
    _closed: boolean;
    _onClose: (err?: Error) => void;
    _autoClosed: (() => void)[];
    _wrapperListeners: { eventName: string; fct: (...args: any[]) => void }[];
    _doesNotEmitClose: boolean;

    constructor(emitter: EmitterT, options?: WrapperOptions) {
        this._emitter = emitter;
        this._closed = false;
        this._wrapperListeners = [];
        this._emitterOn('close', () => {
            this._onClose && this._onClose();
        });
        // hook for subclasses
        this._autoClosed = [];
        this._onClose = this._trackClose;
        this._doesNotEmitClose = options?.doesNotEmitClose || false;
    }

    _trackClose() {
        this._closed = true;
        this._autoClosed.forEach(fn => {
            fn.call(this);
        });
    }

    _emitterOn(eventName: string, fct: (...args: any[]) => void) {
        this._wrapperListeners.push({eventName, fct});
        this._emitter.on(eventName, fct);
    }

    async close() {
        await wait(cb => {
            if (this._closed) return cb(null);
            const close = this._emitter.end || this._emitter.close || this._emitter.destroySoon;
            if (typeof close !== 'function') return cb(null);
            this._onClose = err => {
                this._closed = true;
                this._onClose = nop;
                if (err) cb(err);
                else cb(null);
                cb = nop;
            };
            if (this._doesNotEmitClose) {
                this._emitter.emit('close');
            }
            close.call(this._emitter);
        });
    }
    /// * `closed = wrapper.closed`
    ///    returns true if the `close` event has been received.
    get closed() {
        return this._closed;
    }
    /// * `emitter = wrapper.unwrap()`
    ///    unwraps and returns the underlying emitter.
    ///    The wrapper should not be used after this call.
    unwrap() {
        this._wrapperListeners.forEach(({eventName, fct}) => {
            this._emitter.removeListener(eventName, fct);
        });
        this._closed = true;
        return this._emitter;
    }
    /// * `emitter = wrapper.emitter`
    ///    returns the underlying emitter. The emitter stream can be used to attach additional observers.
    get emitter() {
        return this._emitter;
    }
}

///
/// ## ReadableStream
///
/// All readable stream wrappers derive from this wrapper.
///
/// * `stream = new streams.ReadableStream(stream[, options])`
///   creates a readable stream wrapper.

export interface ReadableOptions extends WrapperOptions {
    lowMark?: number;
    highMark?: number;
    destroyOnStop?: boolean;
}

export type Data = string | Buffer;

export class ReadableStream<EmitterT extends NodeJS.ReadableStream> extends Wrapper<EmitterT> {
    _low: number;
    _high: number;
    _paused: boolean;
    _current: number;
    _chunks: Data[];
    _error: Error;
    _done: boolean;
    _encoding: string | null;
    _onData: (err?: Error, chunk?: Data) => void;
    _destroyOnClose: boolean;
    /// * `reader = stream.reader`
    ///   returns a clean f reader.
    reader: Reader<any>;
    constructor(emitter: EmitterT, options?: ReadableOptions) {
        super(emitter, options);
        options = options || {};
        this._low = Math.max(options.lowMark || 0, 0);
        this._high = Math.max(options.highMark || 0, this._low);
        this._paused = false;
        this._current = 0;
        this._chunks = [];
        this._done = false;
        // initialize _onData before setting listeners because listeners may emit data events immediately
        // (during the `on` call!)
        this._onData = this._trackData;
        this._destroyOnClose = options.destroyOnStop || false;

        this._emitterOn('error', (err: Error) => {
            this._onData(err);
        });
        this._emitterOn('data', (chunk: Data) => {
            this._onData(undefined, chunk);
        });
        this._emitterOn('end', () => {
            this._onData();
        });

        this._autoClosed.push(() => {
            if (!this._done) this._onData(new Error('stream was closed unexpectedly'));
        });
        this.reader = generic.reader(this._readChunk.bind(this), this.stop.bind(this));
    }

    _trackData(err: Error, chunk?: Data) {
        if (err) this._error = err;
        else if (chunk) {
            this._chunks.push(chunk);
            this._current += chunk.length;
            if (this._current > this._high && !this._paused && !this._done && !this._error && !this._closed) {
                this._emitter.pause();
                this._paused = true;
            }
        } else this._done = true;
    }

    async _readChunk() {
        if (this._chunks.length > 0) {
            const chunk = this._chunks.splice(0, 1)[0];
            this._current -= chunk.length;
            if (this._current <= this._low && this._paused && !this._done && !this._error && !this._closed) {
                this._emitter.resume();
                this._paused = false;
            }
            return chunk;
        } else if (this._done) {
            if (this._paused) {
                // resume it for keep-alive
                try {
                    if (!this._closed) this._emitter.resume();
                    this._paused = false;
                } catch (e) {
                    // socket may be closed
                }
            }
            return undefined;
        } else if (this._error) {
            // should we resume if paused?
            throw this._error;
        } else {
            let replied = false;
            return wait(
                new Promise((resolve, reject) => {
                    this._onData = (err, chunk) => {
                        if (err) this._error = err;
                        else if (!chunk) this._done = true;
                        this._onData = this._trackData; // restore it
                        if (!replied) {
                            if (err) reject(err);
                            else resolve(chunk != null ? chunk : undefined);
                        }
                        replied = true;
                    };
                }),
            );
        }
    }

    _concat(chunks: Data[], total: number) {
        if (this._encoding) return chunks.join('');
        if (chunks.length === 1) return chunks[0];
        const result = Buffer.alloc(total);
        chunks.reduce((val, chunk) => {
            if (typeof chunk === 'string') throw new Error('expected Buffer, not string');
            chunk.copy(result, val);
            return val + chunk.length;
        }, 0);
        return result;
    }
    /// * `stream.setEncoding(enc)`
    ///   sets the encoding.
    ///   returns `this` for chaining.
    setEncoding(enc: BufferEncoding | null) {
        this._encoding = enc;
        if (enc) this._emitter.setEncoding(enc);
        return this;
    }
    /// * `data = await stream.read([len])`
    ///   reads asynchronously from the stream and returns a `string` or a `Buffer` depending on the encoding.
    ///   If a `len` argument is passed, the `read` call returns when `len` characters or bytes
    ///   (depending on encoding) have been read, or when the underlying stream has emitted its `end` event
    ///   (so it may return less than `len` bytes or chars).
    ///   Reads till the end if `len` is negative.
    ///   Without `len`, the read calls returns the data chunks as they have been emitted by the underlying stream.
    ///   Once the end of stream has been reached, the `read` call returns `null`.
    async read(len?: number) {
        if (this._closed && !this._chunks.length) return undefined;
        if (len == null) return this.reader.read();
        if (len < 0) len = Infinity;
        if (len === 0) return this._encoding ? '' : Buffer.alloc(0);
        const chunks: Data[] = [];
        let total = 0;
        while (total < len) {
            const chunk = await this.reader.read();
            if (!chunk) return chunks.length === 0 ? undefined : this._concat(chunks, total);
            if (total + chunk.length <= len) {
                chunks.push(chunk);
                total += chunk.length;
            } else {
                chunks.push(chunk.slice(0, len - total));
                this.unread(chunk.slice(len - total));
                total = len;
            }
        }
        return this._concat(chunks, total);
    }
    /// * `data = await stream.readAll()`
    ///   reads till the end of stream.
    ///   Equivalent to `stream.read(-1)`.
    async readAll() {
        const result = await this.read(-1);
        return result === undefined ? null : result;
    }
    /// * `stream.unread(chunk)`
    ///   pushes the chunk back to the stream.
    ///   returns `this` for chaining.
    unread(chunk: Data) {
        if (chunk) {
            this._chunks.splice(0, 0, chunk);
            this._current += chunk.length;
        }
        return this;
    }

    /// * `len = stream.available()`
    ///   returns the number of bytes/chars that have been received and not read yet.
    available() {
        return this._chunks.reduce((count, chunk) => {
            return count + chunk.length;
        }, 0);
    }

    async stop(arg?: any) {
        if (arg && arg !== true) this._error = this._error || arg;
        if (!this.closed) {
            this.unwrap();
            if (this._destroyOnClose && this._emitter instanceof stream.Readable) {
                this._emitter.destroy();
            }
        }
    }

    get events() {
        return ['error', 'data', 'end', 'close'];
    }
}

///
/// ## WritableStream
///
/// All writable stream wrappers derive from this wrapper.
///
/// * `stream = new streams.WritableStream(stream[, options])`
///   creates a writable stream wrapper.

export interface WritableOptions extends WrapperOptions {
    encoding?: BufferEncoding;
}

export class WritableStream<EmitterT extends NodeJS.WritableStream> extends Wrapper<EmitterT> {
    _error: Error;
    _onDrain: (err?: Error) => void;
    _encoding?: BufferEncoding;
    /// * `writer = stream.writer`
    ///   returns a clean f writer.
    writer: Writer<any>;
    constructor(emitter: EmitterT, options?: WritableOptions) {
        super(emitter, options);
        options = options || {};
        this._encoding = options.encoding;

        this._emitterOn('error', (err: Error) => {
            if (this._onDrain) this._onDrain(err);
            else this._error = err;
        });
        this._emitterOn('drain', () => {
            if (this._onDrain) this._onDrain();
        });

        this._autoClosed.push(() => {
            const err = new Error('stream was closed unexpectedly');
            if (this._onDrain) this._onDrain(err);
            else this._error = err;
        });
        this.writer = generic.writer(async (data?: Data) => {
            // emitter has been closed before writer end, consider this as normal
            if (data == null && this._closed) {
                return this.writer;
            }
            if (this._error) throw new Error(this._error.message);
            // node streams don't differentiate between null and undefined. So end in both cases
            if (data != null) {
                // if data is empty do nothing but it's not to be interpreted as end
                if (!data.length) return this.writer;
                if (typeof data === 'string') data = Buffer.from(data, this._encoding || 'utf8');
                //
                if (!this._emitter.write(data)) await this._drain();
            } else {
                await wait(cb => this._emitter.end.call(this._emitter, cb));
            }
            return this.writer;
        });
    }

    async _drain() {
        await wait(cb => {
            this._onDrain = err => {
                this._onDrain = nop;
                if (err) cb(err);
                else cb(null);
                cb = nop;
            };
        });
    }

    /// * `await stream.write(data[, enc])`
    ///   Writes the data.
    ///   This operation is asynchronous because it _drains_ the stream if necessary.
    ///   Returns `this` for chaining.
    async write(data?: Data, enc?: BufferEncoding) {
        if (typeof data === 'string') data = Buffer.from(data, enc || this._encoding || 'utf8');
        else if (data === null) data = undefined;
        await this.writer.write(data);
        return this;
    }

    /// * `stream.end()`
    ///   signals the end of the send operation.
    ///   Returns `this` for chaining.
    end(data?: Data, enc?: BufferEncoding) {
        if (this.writer.ended) {
            if (data != null) throw new Error('invalid attempt to write after end');
            return this;
        }
        if (typeof data === 'string') data = Buffer.from(data, enc || this._encoding || 'utf8');
        else if (data === null) data = undefined;
        if (data !== undefined) {
            this.writer.write(data).then(
                () => this.end(),
                err => {
                    throw err;
                },
            );
        } else {
            this.writer.write().catch(err => {
                throw err;
            });
        }
        return this;
    }

    get events() {
        return ['drain', 'close'];
    }
}

function _getSupportedEncoding(enc: string): BufferEncoding | null {
    // List of charsets: http://www.iana.org/assignments/character-sets/character-sets.xml
    // Node Buffer supported encodings: http://nodejs.org/api/buffer.html#buffer_buffer
    switch (enc.trim().toLowerCase()) {
        case 'utf8':
        case 'utf-8':
            return 'utf8';
        case 'utf16le':
        case 'utf-16le':
            return 'utf16le';
        case 'us-ascii':
            return 'ascii';
        case 'iso-8859-1':
        case 'win-1252':
            return 'binary';
    }
    return null; // we do not understand this charset - do *not* encode
}

function _getEncodingDefault(headers: http.IncomingHttpHeaders): BufferEncoding | null {
    const comps = (headers['content-type'] || 'text/plain').split(';');
    const ctype = comps[0];
    for (let i = 1; i < comps.length; i++) {
        const pair = comps[i].split('=');
        if (pair.length === 2 && pair[0].trim() === 'charset') {
            return _getSupportedEncoding(pair[1]);
        }
    }
    if (ctype.indexOf('text') >= 0 || ctype.indexOf('json') >= 0) return 'utf8';
    return null;
}

function _getEncodingStrict(headers: http.IncomingHttpHeaders) {
    // As per RFC-2616-7.2.1, if media type is unknown we should treat it
    // as "application/octet-stream" (may optionally try to determine it by
    // looking into content body - we don't)
    if (!headers['content-type'] || headers['content-encoding']) return null;

    const comps = headers['content-type'].split(';');
    const ctype = comps[0];
    for (let i = 1; i < comps.length; i++) {
        const pair = comps[i].split('=');
        if (pair.length === 2 && pair[0].trim() === 'charset') {
            return _getSupportedEncoding(pair[1]);
        }
    }
    return null;
}

export interface EncodingOptions {
    detectEncoding?: 'strict' | 'disable' | ((headers: http.IncomingHttpHeaders) => BufferEncoding);
}
function _getEncoding(headers: http.IncomingHttpHeaders, options?: EncodingOptions): BufferEncoding | null {
    if (headers['content-encoding']) return null;
    if (!options) return _getEncodingDefault(headers);
    if (typeof options.detectEncoding === 'function') return options.detectEncoding(headers);
    switch (options.detectEncoding) {
        case 'strict':
            return _getEncodingStrict(headers);
        case 'disable':
            return null;
        default:
            return _getEncodingDefault(headers);
    }
}

///
/// ## HttpServerRequest
///
/// This is a wrapper around node's `http.ServerRequest`:
/// This stream is readable (see `ReadableStream` above).
///
/// * `request = new streams.HttpServerRequest(req[, options])`
///    returns a wrapper around `req`, an `http.ServerRequest` object.
///    The `options` parameter can be used to pass `lowMark` and `highMark` values, or
///    to control encoding detection (see section below).

export interface HttpServerOptions extends ReadableOptions, WritableOptions, EncodingOptions, https.ServerOptions {
    createServer?: (
        listener: (request: http.IncomingMessage, response: http.ServerResponse) => void,
    ) => http.Server | https.Server;
    secure?: boolean;
    withContext?: boolean;
}

export class HttpServerRequest extends ReadableStream<http.IncomingMessage> {
    constructor(req: http.IncomingMessage, options?: HttpServerOptions) {
        super(req, { doesNotEmitClose: true, ...options });
        this.setEncoding(_getEncoding(req.headers, options));
        // special sage hack - clean up later
        if ((req as any).session) (this as any).session = (req as any).session;
    }

    // method, url, headers and trailers are read-write - for compatibility
    get method() {
        return this._emitter.method!;
    }
    set method(val: string) {
        this._emitter.method = val;
    }
    get url() {
        return this._emitter.url!;
    }
    set url(val: string) {
        this._emitter.url = val;
    }
    get headers() {
        return this._emitter.headers;
    }
    set headers(val: any) {
        this._emitter.headers = val;
    }
    get trailers() {
        return this._emitter.trailers;
    }
    set trailers(val: any) {
        this._emitter.trailers = val;
    }
    get rawHeaders() {
        return this._emitter.rawHeaders;
    }
    get rawTrailers() {
        return this._emitter.rawTrailers;
    }
    get httpVersion() {
        return this._emitter.httpVersion;
    }
    get connection() {
        return this._emitter.connection;
    }
    get socket() {
        return this._emitter.socket;
    }
    get statusCode() {
        return this._emitter.statusCode;
    }
    get statusMessage() {
        return this._emitter.statusMessage;
    }
    // sage hack
    get client() {
        return (this._emitter as any).client;
    }
}

// compat API: hide from typescript
Object.defineProperty(HttpServerRequest.prototype, '_request', {
    get(this: HttpServerRequest) {
        return this._emitter;
    },
});
///
/// ## HttpServerResponse
///
/// This is a wrapper around node's `http.ServerResponse`.
/// This stream is writable (see `WritableStream` above).
///
/// * `response = new streams.HttpServerResponse(resp[, options])`
///   returns a wrapper around `resp`, an `http.ServerResponse` object.

export class HttpServerResponse extends WritableStream<http.ServerResponse> {
    constructor(resp: http.ServerResponse, options?: HttpServerOptions) {
        super(resp, { doesNotEmitClose: true, ...options });
    }
    /// * `response.writeContinue()`
    writeContinue() {
        this._emitter.writeContinue();
        return this;
    }
    /// * `response.writeHead(statusCode, headers)`
    writeHead(statusCode: number, headers?: any): this;
    writeHead(statusCode: number, reasonPhrase?: string, headers?: any) {
        this._emitter.writeHead(statusCode, reasonPhrase, headers);
        return this;
    }
    /// * `response.setHeader(name, value)`
    setHeader(name: string, value: string | string[]) {
        this._emitter.setHeader(name, value);
        return this;
    }
    /// * `value = response.getHeader(head)`
    getHeader(name: string) {
        return this._emitter.getHeader(name);
    }
    /// * `response.removeHeader(name)`
    removeHeader(name: string) {
        this._emitter.removeHeader(name);
        return this;
    }
    /// * `response.addTrailers(trailers)`
    addTrailers(trailers: any) {
        this._emitter.addTrailers(trailers);
        return this;
    }
    /// * `response.statusCode = value`
    get statusCode() {
        return this._emitter.statusCode;
    }
    set statusCode(val: number) {
        this._emitter.statusCode = val;
    }
    /// * `response.statusMessage = value`
    get statusMessage() {
        return this._emitter.statusMessage;
    }
    set statusMessage(val: string) {
        this._emitter.statusMessage = val;
    }
    ///   (same as `http.ServerResponse`)

    /// * `locals = response.locals`
    ///   (same as `express.Reponse`)
    get locals() {
        return (this._emitter as any).locals;
    }
}

function _fixHttpServerOptions(options?: HttpServerOptions) {
    const opts = options || {};
    opts.createServer = function(listener): http.Server | https.Server {
        if (typeof listener !== 'function') throw new TypeError('bad listener parameter: ' + typeof listener);
        return opts.secure ? https.createServer(opts, listener) : http.createServer(listener);
    };
    return opts;
}

// Abstract class shared by HttpServer and NetServer
export interface ServerEmitter extends Emitter {
    listen(...args: any[]): void;
}

export class Server<EmitterT extends ServerEmitter> extends Wrapper<EmitterT> {
    constructor(emitter: EmitterT) {
        super(emitter);
    }
    async listen(...args: any[]) {
        return wait(cb => {
            if (this._closed) return cb(new Error('cannot listen: server is closed'));
            const reply = (err: Error | undefined, result?: Server<EmitterT>) => {
                if (err) cb(err);
                else cb(null, result);
                cb = nop;
            };
            args.push(() => {
                reply(undefined, this);
            });

            this._autoClosed.push(() => {
                reply(new Error('server was closed unexpectedly'));
            });
            this._emitterOn('error', reply);
            this._emitter.listen.apply(this._emitter, args);
        });
    }
}

///
/// ## HttpServer
///
/// This is a wrapper around node's `http.Server` object:
///
/// * `server = streams.createHttpServer(requestListener[, options])`
///   creates the wrapper.
///   `requestListener` is called as `requestListener(request, response)`
///   where `request` and `response` are wrappers around `http.ServerRequest` and `http.ServerResponse`.
///   A fresh empty global context is set before every call to `requestListener`. See [Global context API](https://github.com/Sage/streamline-runtime/blob/master/index.md).
/// * `await server.listen(port[, host])`
/// * `await server.listen(path)`
///   (same as `http.Server`)

export type HttpListener = (request: HttpServerRequest, response: HttpServerResponse) => void | Promise<void>;

export function httpListener(listener: HttpListener, options: HttpServerOptions) {
    options = options || {};
    return async (request: http.IncomingMessage, response: http.ServerResponse) => {
        try {
            if (options.withContext) {
                await run(async () =>
                    await withContext(
                        async () => listener(new HttpServerRequest(request, options), new HttpServerResponse(response, options)),
                        {},
                    ),
                );
            } else {
                await listener(new HttpServerRequest(request, options), new HttpServerResponse(response, options));
            }
        } catch (err) {
            // handlers do not read GET requests - so we remove the listeners, in case
            if (!/^(post|put)$/i.test(request.method || 'get')) request.removeAllListeners();
            if (err) throw err;
        }
    };
}

export function createHttpServer(requestListener: HttpListener, options: HttpServerOptions) {
    return new HttpServer(requestListener, options);
}

export class HttpServer extends Server<http.Server | https.Server> {
    constructor(requestListener: HttpListener, options: HttpServerOptions) {
        const opts = _fixHttpServerOptions(options);
        super(opts.createServer!(httpListener(requestListener, options)));
    }
    setTimeout(msecs: number, callback: () => void) {
        // node.js version lower than 0.11.2 do not inmplement a https.Server.setTimeout method.
        if ((this._emitter as any).setTimeout) (this._emitter as http.Server).setTimeout(msecs, callback);
        return this;
    }
}

///
/// ## HttpClientResponse
///
/// This is a wrapper around node's `http.ClientResponse`
///
/// This stream is readable (see `ReadableStream` above).
///
/// * `response = new HttpClientResponse(resp, options)`
///   wraps a node response object.
///   `options.detectEncoding` and be used to control encoding detection (see section below).
/// * `response = await request.response()`
///    returns the response stream.

export interface HttpClientResponseOptions extends ReadableOptions, WritableOptions, EncodingOptions {}

export class HttpClientResponse extends ReadableStream<http.IncomingMessage> {
    constructor(resp: http.IncomingMessage, options?: HttpClientResponseOptions) {
        super(resp, options);
        this.setEncoding(_getEncoding(resp.headers, options));
    }
    /// * `status = response.statusCode`
    ///    returns the HTTP status code.
    get statusCode() {
        return this._emitter.statusCode;
    }
    get statusMessage() {
        return this._emitter.statusMessage;
    }
    /// * `version = response.httpVersion`
    ///    returns the HTTP version.
    get httpVersion() {
        return this._emitter.httpVersion;
    }
    /// * `headers = response.headers`
    ///    returns the HTTP response headers.
    get headers() {
        return this._emitter.headers;
    }
    /// * `trailers = response.trailers`
    ///    returns the HTTP response trailers.
    get trailers() {
        return this._emitter.trailers;
    }
    get rawHeaders() {
        return this._emitter.rawHeaders;
    }
    get rawTrailers() {
        return this._emitter.rawTrailers;
    }

    /// * `response.checkStatus(statuses)`
    ///    throws an error if the status is not in the `statuses` array.
    ///    If only one status is expected, it may be passed directly as an integer rather than as an array.
    ///    Returns `this` for chaining.
    checkStatus(statuses: number | number[]) {
        if (typeof statuses === 'number') statuses = [statuses];
        if (this.statusCode == null || statuses.indexOf(this.statusCode) < 0) {
            throw new Error('invalid status: ' + this.statusCode);
        }
        return this;
    }
}

export interface HttpClientOptions extends HttpClientResponseOptions {
    url?: string | null;
    protocol?: string | null;
    host?: string | null;
    port?: string | null;
    path?: string | null;
    method?: string | null;
    headers?: http.IncomingHttpHeaders;
    module?: any;
    user?: string;
    password?: string;
    proxy?: any; // refine later
    proxyAuthenticate?: any; // refine later
    isHttps?: boolean;
    socket?: net.Socket;
    agent?: http.Agent | boolean;
}

function _fixHttpClientOptions(options: HttpClientOptions) {
    if (!options) throw new Error('request error: no options');
    let opts = options;
    if (typeof opts === 'string') opts = { url: opts };
    if (opts.url) {
        const parsed = parseUrl(opts.url);
        opts.protocol = parsed.protocol;
        opts.host = parsed.hostname;
        opts.port = parsed.port;
        opts.path = parsed.pathname + (parsed.query ? '?' + parsed.query : '');
    }
    opts.destroyOnStop = opts.destroyOnStop ?? true;
    opts.protocol = opts.protocol || 'http:';
    opts.port = opts.port || (opts.protocol === 'https:' ? '443' : '80');
    opts.path = opts.path || '/';
    if (!opts.host) throw new Error('request error: no host');
    opts.method = opts.method || 'GET';
    opts.headers = Object.keys(opts.headers || {}).reduce(
        (headers, key) => {
            if (opts.headers![key] != null) headers[key] = opts.headers![key];
            return headers;
        },
        {} as http.IncomingHttpHeaders,
    );

    opts.module = options.module || (opts.protocol === 'https:' ? https : http);
    if (opts.user != null) {
        // assumes basic auth for now
        let token = opts.user + ':' + (opts.password || '');
        token = Buffer.from(token, 'utf8').toString('base64');
        opts.headers['Authorization'] = 'Basic ' + token;
    }

    if (opts.proxy) {
        // Do not use proxy for local requests
        if (opts.host !== os.hostname()) {
            if (typeof opts.proxy === 'string') {
                opts.proxy = parseUrl(opts.proxy);
                opts.proxy.host = opts.proxy.hostname;
            }
            // Check excludes
            if (
                !opts.proxy.force &&
                opts.proxy.excludes &&
                opts.proxy.excludes.indexOf(opts.host.toLowerCase()) !== -1
            ) {
                // Do nothing
            } else {
                opts.proxy.port = opts.proxy.port || opts.port;
                if (!opts.proxy.host) throw new Error('proxy configuration error: no host');
                if (!opts.proxy.port) throw new Error('proxy configuration error: no port');
                opts.proxy.protocol = opts.proxy.protocol || 'http:';
                // https requests will be handled with CONNECT method
                opts.isHttps = opts.protocol.substr(0, 5) === 'https';
                if (opts.isHttps) {
                    opts.proxy.module = (opts.proxy.protocol === 'https:' ? https : http);
                    opts.proxy.headers = opts.proxy.headers || {};
                    opts.proxy.headers.host = opts.host;
                } else {
                    opts.path = opts.protocol + '//' + opts.host + ':' + opts.port + opts.path;
                    opts.host = opts.proxy.host;
                    opts.port = opts.proxy.port;
                    if (opts.host) opts.headers['host'] = opts.host;
                }

                if (opts.proxy.auth) {
                    if (opts.proxy.auth.toLowerCase() === 'basic') {
                        if (!opts.proxy.user) throw new Error('request error: no proxy user');
                        let proxyToken = opts.proxy.user + ':' + (opts.proxy.password || '');
                        proxyToken = Buffer.from(proxyToken, 'utf8').toString('base64');
                        opts.headers['Proxy-Authorization'] = 'Basic ' + proxyToken;
                    } else if (opts.proxy.auth.toLowerCase() === 'ntlm') {
                        const proxyAuthenticator = opts.proxy.proxyAuthenticator;
                        if (!proxyAuthenticator) throw new Error('Proxy Authenticator module required');
                        if (!proxyAuthenticator.authenticate) {
                            throw new Error("NTLM Engine module MUST provide 'authenticate' function");
                        }
                        opts.proxyAuthenticate = proxyAuthenticator.authenticate;
                    } else if (opts.proxy.auth.toLowerCase() === 'digest') {
                        throw new Error('Proxy Digest authentication not yet implemented');
                    }
                }
            }
        }
    }
    return opts;
}

///
/// ## HttpClientRequest
///
/// This is a wrapper around node's `http.ClientRequest`.
///
/// This stream is writable (see `WritableStream` above).
///
/// * `request = streams.httpRequest(options)`
///    creates the wrapper.
///    The options are the following:
///    * `method`: the HTTP method, `'GET'` by default.
///    * `headers`: the HTTP headers.
///    * `url`: the requested URL (with query string if necessary).
///    * `proxy.url`: the proxy URL.
///    * `lowMark` and `highMark`: low and high water mark values for buffering (in bytes or characters depending
///      on encoding).
///      Note that these values are only hints as the data is received in chunks.

export class HttpClientRequest extends WritableStream<http.ClientRequest> {
    _response: http.IncomingMessage;
    _done: boolean;
    _onResponse: (err: Error | undefined, response?: http.IncomingMessage) => void;
    _options: HttpClientOptions;

    constructor(options: HttpClientOptions) {
        const request = options.module.request(options, (response: http.IncomingMessage) => {
            this._onResponse(undefined, response);
        });
        super(request, options);
        this._options = options;
        this._done = false;

        this._emitterOn('error', (err: Error) => {
            if (!this._done) this._onResponse(err);
        });

        this._autoClosed.push(() => {
            if (!this._done) this._onResponse(new Error('stream was closed unexpectedly'));
        });
        this._onResponse = this._trackResponse;
    }
    _trackResponse(err: Error | undefined, resp?: http.IncomingMessage) {
        this._done = true;
        if (err) this._error = err;
        if (resp) this._response = resp;
    }

    _responseCb(callback: (err?: Error, resp?: http.IncomingMessage) => void) {
        let replied = false;
        if (typeof callback !== 'function') throw new TypeError('bad callback parameter: ' + typeof callback);
        if (this._done) return callback(this._error, this._response);
        else {
            this._onResponse = (err, resp) => {
                this._done = true;
                if (!replied) callback(err, resp);
                replied = true;
            };
        }
    }

    /// * `response = await request.response()`
    ///    returns the response.
    async response() {
        const response = this._response || await wait(this._responseCb.bind(this));
        return new HttpClientResponse(response, this._options); // options.reader?
    }
    setTimeout(ms: number) {
        this._emitter.setTimeout(ms, () => {
            this._emitter.emit('error', 'timeout');
        });
        return this;
    }
    proxyConnect() {
        return this;
    }
}

export class HttpProxyClientRequest {
    _options: HttpClientOptions;

    constructor(options: HttpClientOptions) {
        this._options = _fixHttpClientOptions(options);
    }
    proxyConnect() {
        const options = this._options;
        if (options.isHttps) {
            // TODO: Don't authenticate with ntlm, nodejs raises "Parse error" in return of connect with 407 -> HPE_INVALID_CONSTANT
            return wait(
                new Promise<HttpClientRequest>((resolve, reject) => {
                    const proxyOpt = {
                        host: options.proxy.host,
                        port: options.proxy.port,
                        method: 'CONNECT',
                        path: options.host + ':' + options.port,
                        headers: options.proxy.headers,
                    };
                    // open proxy socket
                    options.proxy.module
                        .request(proxyOpt)
                        .on('connect', (res: never, socket: net.Socket, head: never) => {
                            options.socket = socket;
                            options.agent = false;
                            //
                            resolve(new HttpClientRequest(options));
                            resolve = reject = nop;
                        })
                        .on('error', (err: Error) => {
                            reject(err);
                            resolve = reject = nop;
                        })
                        .end();
                }),
            );
        } else {
            //
            if (options.proxyAuthenticate) {
                options.proxyAuthenticate(options);
            }
            return new HttpClientRequest(options);
        }
    }
    response() {
        throw new Error('proxyConnect() call missing');
    }
}

export function httpRequest(options: HttpClientOptions): HttpProxyClientRequest | HttpClientRequest {
    options = _fixHttpClientOptions(options);
    if (options.isHttps || options.proxyAuthenticate) return new HttpProxyClientRequest(options);
    else return new HttpClientRequest(options);
}

///
/// ## NetStream
///
/// This is a wrapper around streams returned by TCP and socket clients:
///
/// These streams are both readable and writable (see `ReadableStream` and `WritableStream` above).
///
/// * `stream = new streams.NetStream(stream[, options])`
///    creates a network stream wrapper.
export interface SocketOptions extends ReadableOptions, WritableOptions {
    read?: ReadableOptions;
    write?: WritableOptions;
}
// we need to hack the net.Socket type, because node.js setEncoding signatures are not aligne.
export class SocketStream extends ReadableStream<net.Socket & NodeJS.ReadableStream> {
    _writableStream: WritableStream<net.Socket>;
    constructor(emitter: net.Socket, options?: SocketOptions) {
        // net.Socket type hack part 2: as any
        super(emitter as any, (options && options.read) || options);
        this._writableStream = new WritableStream(emitter, (options && options.write) || options);
    }
    // no multiple inheritance - so we delegate WritableStream methods
    async write(data?: Data, enc?: BufferEncoding) {
        await this._writableStream.write(data, enc);
        return this;
    }
    end(data?: Data, enc?: BufferEncoding) {
        this._writableStream.end(data, enc);
        return this;
    }
    get writer() {
        return this._writableStream.writer;
    }
    setTimeout(ms: number, callback?: () => void) {
        this._emitter.setTimeout(ms, callback);
        return this;
    }
    setNoDelay(noDelay?: boolean) {
        this._emitter.setNoDelay(noDelay);
        return this;
    }
    setKeepAlive(enable?: boolean) {
        this._emitter.setKeepAlive(enable);
        return this;
    }
    ref() {
        this._emitter.ref();
        return this;
    }
    unref() {
        this._emitter.unref();
        return this;
    }
    destroy() {
        this._emitter.destroy();
        return this;
    }
    address() {
        // TODO: remove as string cast: this is a temp hack to get around an inconsistency in node definition files
        return this._emitter.address();
    }
    get localAddress() {
        return this._emitter.localAddress;
    }
    get localPort() {
        return this._emitter.localPort;
    }
    get remoteAddress() {
        return this._emitter.remoteAddress;
    }
    get remotePort() {
        return this._emitter.remotePort;
    }
}

///
/// ## TCP and Socket clients
///
/// These are wrappers around node's `net.createConnection`:
///
/// * `client = streams.tcpClient(port, host[, options])`
///    returns a TCP connection client.
/// * `client = streams.socketClient(path[, options])`
///    returns a socket client.
///    The `options` parameter of the constructor provide options for the stream (`lowMark` and `highMark`).
///    If you want different options for `read` and `write` operations, you can specify them by creating `options.read` and `options.write` sub-objects inside `options`.

export function tcpClient(port: number, host?: string, options?: SocketOptions) {
    host = host || 'localhost';
    options = options || {};
    return new SocketClient(options, port, host);
}
export function socketClient(path: string, options?: SocketOptions) {
    options = options || {};
    return new SocketClient(options, path);
}

export class SocketClient {
    _options?: SocketOptions;
    _connection: net.Socket;
    _error: Error;
    _done: boolean;
    _onConnect: (err?: Error) => void;
    constructor(options?: SocketOptions, ...args: any[]) {
        this._options = options;
        this._connection = net.createConnection.apply(net, args);
        this._connection.on('error', (err: Error) => {
            if (!this._done) this._onConnect(err);
            this._onConnect = nop;
        });
        this._connection.on('connect', () => {
            this._onConnect();
            this._onConnect = nop;
        });
        this._onConnect = this._trackConnect;
    }

    _trackConnect(err?: Error) {
        this._done = true;
        if (err) this._error = err;
    }

    /// * `stream = client.connect()`
    ///    connects the client and returns a network stream.
    connect(callback: (err?: Error, stream?: SocketStream) => void) {
        if (typeof callback !== 'function') throw new TypeError('bad callback parameter: ' + typeof callback);
        if (this._done) return callback(this._error, new SocketStream(this._connection, this._options));
        else {
            this._onConnect = err => {
                this._done = true;
                callback(err, new SocketStream(this._connection, this._options));
                callback = nop;
            };
        }
    }
}

///
/// ## NetServer
///
/// This is a wrapper around node's `net.Server` object:
///
/// * `server = streams.createNetServer([serverOptions,] connectionListener [, streamOptions])`
///   creates the wrapper.
///   `connectionListener` is called as `connectionListener(stream)`
///   where `stream` is a `NetStream` wrapper around the native connection.
///   A fresh empty global context is set before every call to `connectionListener`. See [Global context API](https://github.com/Sage/streamline-runtime/blob/master/index.md).
/// * `await server.listen(port[, host])`
/// * `await server.listen(path)`
///   (same as `net.Server`)

export interface SocketServerOptions {
    allowHalfOpen?: boolean; // from net.d.ts
    pauseOnConnect?: boolean; // from net.d.ts
    withContext?: boolean; // local
}
export type SocketServerListener = (stream: SocketStream) => void | Promise<void>;

export function createNetServer(
    serverOptions: SocketServerOptions,
    connectionListener: SocketServerListener,
    streamOptions: SocketOptions,
) {
    return new SocketServer(serverOptions, connectionListener, streamOptions);
}

export class SocketServer extends Server<net.Server> {
    constructor(
        serverOptions: SocketServerOptions,
        connectionListener: SocketServerListener,
        streamOptions: SocketOptions,
    ) {
        if (typeof serverOptions === 'function') {
            streamOptions = connectionListener as any;
            connectionListener = serverOptions as (stream: SocketStream) => void;
            serverOptions = {};
        }
        const emitter = net.createServer(serverOptions, async connection => {
            if (serverOptions.withContext) {
                await run(async () =>
                    await withContext(async () => connectionListener(new SocketStream(connection, streamOptions || {})), {}),
                ).catch(err => {
                    if (err) throw err;
                });
            } else {
                await connectionListener(new SocketStream(connection, streamOptions || {}));
            }
        });
        super(emitter);
    }
}

// Obsolete API - use legacy exports to keep it hidden in TypeScript

/// !nodoc
/// ## try/finally wrappers and pump
///
/// * `result = streams.using(constructor, stream[, options], fn)`
///    wraps `stream` with an instance of `constructor`;
///    passes the wrapper to `fn(wrapper)` and closes the stream after `fn` returns.
///    `fn` is called inside a `try/finally` block to guarantee that the stream is closed in all cases.
///    Returns the value returned by `fn`.
exports.using = function(
    this: any,
    constructor: any,
    emitter: NodeJS.EventEmitter,
    options?: any,
    fn?: (stream: any) => any,
) {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    if (!fn && typeof options === 'function') {
        fn = options;
        options = null;
    }
    if (!fn) throw new Error('using body missing');
    const _stream = new constructor(emitter, options);
    try {
        return fn.call(this, _stream);
    } finally {
        _stream.close();
    }
};

/// * `result = streams.usingReadable(stream[, options], fn)`
///    shortcut for `streams.using(streams.ReadableStream, stream, options, fn)`
exports.usingReadable = function(
    this: any,
    emitter: NodeJS.ReadableStream,
    options?: ReadableOptions,
    fn?: (stream: any) => any,
) {
    return exports.using.call(this, ReadableStream, emitter, options, fn);
};

/// * `result = streams.usingWritable(stream[, options], fn)`
///    shortcut for `streams.using(streams.WritableStream, stream, options, fn)`
exports.usingWritable = function(
    this: any,
    emitter: NodeJS.WritableStream,
    options?: WritableOptions,
    fn?: (stream: any) => any,
) {
    return exports.using.call(this, WritableStream, emitter, options, fn);
};

/// * `await streams.pump(inStream, outStream)`
///    Pumps from `inStream` to `outStream`.
///    Does not close the streams at the end.
exports.pump = async function(inStream: ReadableStream<any>, outStream: WritableStream<any>) {
    let data: any;
    while ((data = await inStream.read())) await outStream.write(data);
};
///
/// ## Encoding detection
///
/// The `options.detectEncoding` option controls how the encoding is sent by the
/// `HttpServerRequest` and `HttpClientResponse` constructors.
/// This option can take the following values:
///
/// * `strict`: the RFC-2616-7.2.1 rules are applied.
/// * `default`: the default algorithm used by streamline v0.4 is used.
///    This algorithm is more lenient and sets the encoding to `utf8` when text content is detected, even
///    if there is no charset indication.
/// * `disable`: null is always returned and the stream is always handled in binary mode (buffers rather than strings).
/// * a function. This is a hook for custom encoding detection.
///   The function is called as `fn(headers)` and returns the encoding.
///
