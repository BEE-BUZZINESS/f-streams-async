/**
 * Copyright (c) 2013 Bruno Jouhier <bruno.jouhier@sage.com>
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 */
/// !doc
/// ## EZ Streams core writer API
///
/// `import * as f from 'f-streams-async'`
///
import * as nodeStream from 'stream';
import * as sys from 'util';
import { ParallelOptions, Reader } from './reader';

export class Writer<T> {
    write: (this: Writer<T>, value?: T) => Promise<this>;
    ended: boolean;
    constructor(write: (value: T) => Promise<Writer<T> | void>, stop?: (arg?: any) => Promise<Writer<T> | void>) {
        if (typeof write !== 'function') throw new Error('invalid writer.write: ' + (write && typeof write));
        this.ended = false;
        this.write = async data => {
            if (data === undefined) {
                if (!this.ended) await write.call(this);
                this.ended = true;
            } else {
                if (this.ended) throw new Error('invalid attempt to write after end');
                await write.call(this, data);
            }
            return this;
        };
        if (stop) {
            this.stop = async (arg?: any) => {
                await stop.call(this, arg);
                return this;
            };
        }
    }

    ///
    /// * `writer = await writer.writeAll(val)`
    ///   writes `val` and ends the writer
    async writeAll(val: T): Promise<Writer<T>> {
        await this.write(val);
        await this.write(undefined);
        return this;
    }

    ///
    /// * `writer = await writer.stop(err)`
    ///   stops the writer.
    ///   by default arg is silently ignored
    async stop(arg?: any): Promise<Writer<T> | void> {
        await this.write(undefined);
        return this;
    }

    ///
    /// * `writer = writer.end()`
    ///   ends the writer - compatiblity call (errors won't be thrown to caller)
    end() {
        if (arguments.length > 0) throw new Error('invalid end call: ' + arguments.length + ' arg(s)');
        this.write(undefined).catch(err => console.error(`end call failed: ${err && err.message}`));
        return this;
    }

    /// * `writer = writer.pre.action(fn)`
    ///   returns another writer which applies `action(fn)` before writing to the original writer.
    ///   `action` may be any chainable action from the reader API: `map`, `filter`, `transform`, ...
    get pre(): Pre<T> {
        return new PreImpl(this) as Pre<T>;
    }

    /// * `stream = writer.nodify()`
    ///   converts the writer into a native node Writable stream.
    nodify() {
        const stream = new nodeStream.Writable();
        // ES2015 does not let us override method directly but we do it!
        // This is fishy. Clean up later (should do it from end event).
        // also very fragile because of optional args.
        const anyStream: any = stream;
        anyStream._write = (chunk: any, encoding?: string, done?: Function) => {
            if (chunk && encoding && encoding !== 'buffer') chunk = chunk.toString(encoding);
            this.write(chunk).then(
                () => {
                    if (done) done();
                },
                err => stream.emit('error', err),
            );
        };
        // override end to emit undefined marker
        const end = stream.end;
        anyStream.end = (chunk: any, encoding?: string, cb?: (err: any, val?: any) => any) => {
            end.call(stream, chunk, encoding, (err: any) => {
                if (err) return stream.emit('error', err) as never;
                this.write(undefined).then(v => cb && cb(null, v), e => cb && cb(e));
                return undefined;
            });
        };
        return stream;
    }
    // optional result getter - only implemneted in some subclasses
    get result(): any {
        throw new Error('result not supported');
    }
}

export function create<T>(write: (value: T) => Promise<Writer<T> | void>, stop?: (arg?: any) => Promise<Writer<T> | void>) {
    return new Writer(write, stop);
}

// * `fwriter.decorate(proto)`
//   Adds the streams writer API to an object.
//   Usually the object is a prototype but it may be any object with a `write(data)` method.
//   Returns `proto` for convenience.
// compat API - don't export in TS
exports.decorate = function(proto: any) {
    const writerProto: any = Writer.prototype;
    Object.getOwnPropertyNames(Writer.prototype).forEach(k => {
        // compare with == is important here!
        if (k === 'constructor' || k === 'result') return;
        if (k === 'pre') {
            Object.defineProperty(proto, k, {
                get(this: Writer<any>) {
                    return new PreImpl(this);
                },
            });
        } else {
            if (!proto[k]) proto[k] = writerProto[k];
        }
    });
    return proto;
};

export class PreImpl<T> {
    writer: Writer<T>;
    constructor(writer: Writer<T>) {
        if (typeof writer.write !== 'function') throw new Error('invalid pre writer: ' + sys.inspect(writer));
        this.writer = writer;
    }
}

export interface Pre<T> extends PreImpl<T> {
    map<U>(fn: (elt: U, index?: number) => T): Promise<Writer<U>>;
    tee(writer: Writer<T>): Promise<Writer<T>>;
    concat(readers: Reader<T>[]): Promise<Writer<T>>;
    transform<U>(fn: (reader: Reader<U>, writer: Writer<T>) => void): Promise<Writer<U>>;
    filter(fn: (elt: T, index?: number) => boolean): Promise<Writer<T>>;
    until(fn: (elt: T, index?: number) => boolean): Promise<Writer<T>>;
    while(fn: (elt: T, index?: number) => boolean): Promise<Writer<T>>;
    limit(n: number, stopArg?: any): Promise<Writer<T>>;
    skip(n: number): Promise<Writer<T>>;
    parallel(options: ParallelOptions | number, consumer: (source: any) => Reader<T>): Promise<Writer<T>>;
    buffer(max: number): Promise<Writer<T>>;
    nodeTransform<U>(duplex: nodeStream.Duplex): Promise<Writer<U>>;
}

// add reader methods to Pre.prototype
// fragile but we'll fix later
process.nextTick(() => {
    const preProto: any = PreImpl.prototype;
    const api: any = Reader.prototype;
    [
        'map',
        'tee',
        'concat',
        'transform',
        'filter',
        'until',
        'while',
        'limit',
        'skip',
        'parallel',
        'buffer',
        'nodeTransform',
    ].forEach(name => {
        preProto[name] = async function(this: Pre<any>, arg: any) {
            const uturn = require('./devices/uturn').create();
            (await uturn.reader[name](arg)).pipe(this.writer).then(
                (result: any) => uturn.end(null, result),
                (err: Error) => uturn.end(err),
            );
            return uturn.writer;
        };
    });
});
