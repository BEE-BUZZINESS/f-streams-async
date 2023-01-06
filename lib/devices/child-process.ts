/// !doc
/// ## EZ Stream wrappers for node child processes
///
/// `import { childProcessReader, childProcessWriter} from 'f-streams-async'`
///
import { ChildProcess } from 'child_process';
import { wait } from 'f-promise-async';
import { stringify } from '../mappers/convert';
import { Reader } from '../reader';
import { parser as linesParser } from '../transforms/lines';
import * as generic from './generic';
import * as node from './node';

/// * `reader = childProcessReader(proc, options)`
///   wraps a node.js child process as a reader.
///   For a full description of the options, see `ReadableStream` in
///   https://github.com/Sage/f-streams/blob/master/lib/node-wrappers.md
export interface ReaderOptions {
    acceptCode?: (code: number) => boolean;
    encoding?: BufferEncoding;
    dataHandler?: (reader: Reader<string | Buffer>) => Reader<string | Buffer>;
    errorHandler?: (reader: Reader<string | Buffer>) => Reader<string | Buffer>;
    errorPrefix?: string;
    errorThrow?: boolean;
}

export function reader(proc: ChildProcess, options?: ReaderOptions) {
    const opts = options || {};
    let err: NodeJS.ErrnoException, closeCb: ((err: Error) => void) | null, closed: boolean;
    proc.on('close', (ec: number) => {
        closed = true;
        if (ec === -1) {
            proc.stdout?.emit('end');
            proc.stderr?.emit('end');
        }
        if (ec && !(opts.acceptCode && opts.acceptCode(ec))) {
            err = new Error('process exited with code:' + ec);
            err.errno = ec;
            // compat code
            const anyErr: any = err;
            anyErr.code = ec;
        }
        if (closeCb) closeCb(err);
        closeCb = null;
    });
    proc.on('error', (e: NodeJS.ErrnoException) => {
        err = err || e;
    });
    let stdout: Reader<string | Buffer> = node.reader(proc.stdout!, opts);
    let stderr: Reader<string | Buffer> = node.reader(proc.stderr!, opts);
    // node does not send close event if we remove all listeners on stdin and stdout
    // so we disable the stop methods and we call stop explicitly after the close.
    const stops = [stdout.stop.bind(stdout), stderr.stop.bind(stderr)];
    stdout.stop = stderr.stop = async () => {};
    async function stopStreams(arg?: any) {
        stops.forEach(stop => {
            stop(arg);
        });
    }
    if ((opts.encoding as any) !== 'buffer') {
        stdout = stdout.map(stringify()).transform(linesParser());
        stderr = stderr.map(stringify()).transform(linesParser());
    }
    if (opts.dataHandler) stdout = opts.dataHandler(stdout);
    if (opts.errorHandler) stderr = opts.errorHandler(stderr);
    if (opts.errorPrefix || opts.errorThrow) {
        stderr = stderr.map(function(data) {
            if (opts.errorThrow) throw new Error((opts.errorPrefix || '') + data);
            return opts.errorPrefix! + data;
        });
    }
    const rd = stdout.join(stderr);
    return generic.reader(async function read() {
        if (err) throw err;
        const data = await rd.read();
        if (data !== undefined) return data;
        // reached end of stream - worry about close event now.
        if (closed) {
            // already got close event
            if (err) throw err;
        } else {
            // wait for the close event
            await wait(cb => {
                closeCb = cb;
            });
            await stopStreams();
        }
        return undefined;
    }, stopStreams);
}
/// * `writer = childProcessWriter(proc, options)`
///   wraps a node.js child process as a writer.
///   For a full description of the options, see `WritableStream` in
///   https://github.com/Sage/f-streams/blob/master/lib/node-wrappers.md

export interface WriterOptions extends node.NodeWriterOptions {}

export function writer(proc: ChildProcess, options: WriterOptions) {
    return node.writer(proc.stdin!, options);
}
