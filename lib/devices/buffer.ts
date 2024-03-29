import { Reader } from '../reader';
import { nextTick } from '../util';
import { Writer } from '../writer';

export interface Options {
    sync?: boolean;
    chunkSize?: number | (() => number);
}

export class BufferWriter extends Writer<Buffer> {
    chunks: Buffer[];
    constructor(options: Options) {
        super(async (data: Buffer) => {
            if (!options.sync) await nextTick();
            if (data !== undefined) this.chunks.push(data);
            return this;
        });
        this.chunks = [];
    }
    toBuffer() {
        return Buffer.concat(this.chunks);
    }
    get result() {
        return this.toBuffer();
    }
}

/// !doc
/// ## In-memory buffer streams
///
/// `import { bufferReader, bufferWriter} from 'f-streams-async'`
///
/// * `reader = bufferReader(buffer, options)`
///   creates a reader that reads its entries from `buffer`.
///   `await reader.read()` will return its entries asynchronously by default.
///   You can force synchronous delivery by setting `options.sync` to `true`.
///   The default chunk size is 1024. You can override it by passing
///   a `chunkSize` option.
export function reader(buffer: Buffer, options?: Options | number) {
    let opts: Options;
    if (typeof options === 'number') {
        opts = {
            chunkSize: options,
        };
    } else opts = options || {};
    const chunkSize = opts.chunkSize || 1024;
    let pos = 0;
    return new Reader(async function read() {
        if (!opts.sync) await nextTick();
        if (pos >= buffer.length) return;
        const len = typeof chunkSize === 'function' ? chunkSize() : chunkSize;
        const s = buffer.slice(pos, pos + len);
        pos += len;
        return s;
    });
}
/// * `writer = bufferWriter(options)`
///   creates a writer that collects data into an buffer.
///   `await writer.write(data)` will write asynchronously by default.
///   You can force synchronous write by setting `options.sync` to `true`.
///   `writer.toBuffer()` returns the internal buffer into which the
///   chunks have been collected.
export function writer(options?: Options) {
    return new BufferWriter(options || {});
}
