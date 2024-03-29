/// !doc
/// ## helpers for binary streams
///
/// `import { binaryReader, binaryWriter } from 'f-streams-async'`
import { Reader as BaseReader } from '../reader';
import { Writer as BaseWriter } from '../writer';

const NUMBERS: [string, number][] = [
    //
    ['Int8', 1],
    ['UInt8', 1], //
    ['Int16', 2],
    ['UInt16', 2], //
    ['Int32', 4],
    ['UInt32', 4], //
    ['Float', 4],
    ['Double', 8],
];

///
/// ----
///
/// * `reader = binaryReader(reader, options)`
///   Wraps a raw Buffer reader and returns a reader with additional API to handle binary streams.
///   By default the reader is configured as big endian.
///   You can configure it as little endian by setting the `endian` option to `"little"`.
export interface ReaderOptions {
    endian?: 'big' | 'little';
}
export class Reader extends BaseReader<Buffer> {
    reader: BaseReader<Buffer>;
    options: ReaderOptions;
    pos: number;
    buf: Buffer | undefined;
    constructor(rd: BaseReader<Buffer>, options: ReaderOptions) {
        ///
        /// * `buf = await reader.read(len)`
        ///   returns the `len` next bytes of the stream.
        ///   returns a buffer of length `len`, except at the end of the stream.
        ///   The last chunk of the stream may have less than `len` bytes and afterwards the call
        ///   returns `undefined`.
        ///   If the `len` parameter is omitted, the call returns the next available chunk of data.
        // peekOnly is internal and not documented
        super(() => this.readData(), (arg?: any) => rd.stop(arg));
        this.reader = rd;
        this.options = options;
        this.pos = 0;
        this.buf = Buffer.alloc(0);
        // override read for compat
        this.read = this.readData;
    }
    async readData(len?: number, peekOnly?: boolean): Promise<Buffer | undefined> {
        if (this.buf === undefined) return undefined;
        if (len === undefined) {
            if (this.pos < this.buf.length) return this.readData(this.buf.length - this.pos, peekOnly);
            else {
                this.buf = await this.reader.read();
                this.pos = this.buf && !peekOnly ? this.buf.length : 0;
                return this.buf;
            }
        }
        const l = await this.ensure(len);
        if (l === 0 && len > 0) return undefined;
        const result = this.buf.slice(this.pos, this.pos + l);
        if (!peekOnly) this.pos += l;
        return result;
    }

    // internal API
    async ensure(len: number) {
        if (this.buf === undefined) return 0;
        if (this.pos + len <= this.buf.length) return len;
        let got = this.buf.length - this.pos;
        const bufs = got ? [this.buf.slice(this.pos)] : [];
        this.pos = 0;
        while (got < len) {
            const buf = await this.reader.read();
            if (buf === undefined) {
                if (bufs.length === 0) return 0;
                else break;
            }
            bufs.push(buf);
            got += buf.length;
        }
        this.buf = Buffer.concat(bufs);
        return Math.min(this.buf.length, len);
    }

    ///
    /// * `buf = await reader.peek(len)`
    ///   Same as `read` but does not advance the read pointer.
    ///   Another `read` would read the same data again.
    async peek(len: number) {
        return await this.readData(len, true);
    }

    ///
    /// * `await reader.peekAll()`
    ///   Same as `readAll` but does not advance the read pointer.
    async peekAll(): Promise<Buffer | undefined> {
        this.buf = await this.readAll() as Buffer;
        this.pos = 0;
        return this.buf;
    }

    ///
    /// * `reader.unread(len)`
    ///   Unread the last `len` bytes read.
    ///   `len` cannot exceed the size of the last read.
    unread(len: number) {
        if (!(len <= this.pos)) throw new Error('invalid unread: expected <= ' + this.pos + ', got ' + len);
        this.pos -= len;
    }
}
///
/// * `val = await reader.readInt8()`
/// * `val = await reader.readUInt8()`
/// * `val = await reader.readInt16()`
/// * `val = await reader.readUInt16()`
/// * `val = await reader.readInt32()`
/// * `val = await reader.readUInt32()`
/// * `val = await reader.readFloat()`
/// * `val = await reader.readDouble()`
///   Specialized readers for numbers.
///
/// * `val = await reader.peekInt8()`
/// * `val = await reader.peekUInt8()`
/// * `val = await reader.peekInt16()`
/// * `val = await reader.peekUInt16()`
/// * `val = await reader.peekInt32()`
/// * `val = await reader.peekUInt32()`
/// * `val = await reader.peekFloat()`
/// * `val = await reader.peekDouble()`
///   Specialized peekers for numbers.
function numberReader(name: string, len: number, peekOnly?: boolean) {
    return async function(this: Reader) {
        const got = await this.ensure(len);
        if (got === 0) return undefined;
        if (got < len) throw new Error('unexpected EOF: expected ' + len + ', got ' + got);
        const result = (this.buf as any)[name](this.pos);
        if (!peekOnly) this.pos += len;
        return result;
    };
}

/// * `val = await reader.unreadInt8()`
/// * `val = await reader.unreadUInt8()`
/// * `val = await reader.unreadInt16()`
/// * `val = await reader.unreadUInt16()`
/// * `val = await reader.unreadInt32()`
/// * `val = await reader.unreadUInt32()`
/// * `val = await reader.unreadFloat()`
/// * `val = await reader.unreadDouble()`
///   Specialized unreaders for numbers.
function numberUnreader(len: number) {
    return function(this: Reader) {
        return this.unread(len);
    };
}

///
/// ----
///
/// * `writer = binaryWriter(writer, options)`
///   Wraps a raw buffer writer and returns a writer with additional API to handle binary streams.
///   By default the writer is configured as big endian.
///   You can configure it as little endian by setting the `endian` option to `"little"`.
///   The `bufSize` option controls the size of the intermediate buffer.
export interface WriterOptions {
    endian?: 'big' | 'little';
    bufSize?: number;
}

export class Writer extends BaseWriter<Buffer> {
    writer: BaseWriter<Buffer>;
    options: WriterOptions;
    pos: number;
    buf: Buffer;
    constructor(wr: BaseWriter<Buffer>, options?: WriterOptions) {
        super(async (buf: Buffer) => {
            await this.writeDate(buf);
            return this;
        }, async (arg?: any) => wr.stop(arg));
        options = options || {};
        this.writer = wr;
        this.options = options;
        this.pos = 0;
        this.buf = Buffer.alloc(options.bufSize && options.bufSize > 0 ? options.bufSize : 16384);
    }

    ///
    /// * `await writer.flush()`
    ///   Flushes the buffer to the wrapped writer.
    async flush() {
        if (this.pos > 0) await this.writer.write(this.buf.slice(0, this.pos));
        // reallocate the buffer because existing buffer belongs to this.writer now.
        this.buf = Buffer.alloc(this.buf.length);
        this.pos = 0;
    }

    // internal call
    async ensure(len: number) {
        if (this.pos + len > this.buf.length) {
            await this.flush();
            if (len > this.buf.length) this.buf = Buffer.alloc(len);
        }
    }

    ///
    /// * `await writer.write(buf)`
    ///   Writes `buf`.
    ///   Note: writes are buffered.
    ///   Use the `await flush()` call if you need to flush before the end of the stream.
    async writeDate(buf: Buffer) {
        if (buf === undefined || buf.length > this.buf.length) {
            await this.flush();
            await this.writer.write(buf);
        } else {
            await this.ensure(buf.length);
            buf.copy(this.buf, this.pos);
            this.pos += buf.length;
        }
    }
}

///
/// * `await writer.writeInt8(val)`
/// * `await writer.writeUInt8(val)`
/// * `await writer.writeInt16(val)`
/// * `await writer.writeUInt16(val)`
/// * `await writer.writeInt32(val)`
/// * `await writer.writeUInt32(val)`
/// * `await writer.writeFloat(val)`
/// * `await writer.writeDouble(val)`
///   Specialized writers for numbers.
function numberWriter(name: string, len: number) {
    return async function(this: Writer, val: number) {
        await this.ensure(len);
        (this.buf as any)[name](val, this.pos);
        this.pos += len;
    };
}

NUMBERS.forEach(function(pair) {
    const len = pair[1];
    const names = len > 1 ? [pair[0] + 'BE', pair[0] + 'LE'] : [pair[0]];
    const readerProto: any = Reader.prototype;
    const writerProto: any = Writer.prototype;
    names.forEach(function(name) {
        readerProto['read' + name] = numberReader('read' + name, len, false);
        readerProto['peek' + name] = numberReader('read' + name, len, true);
        readerProto['unread' + name] = numberUnreader(len);
        writerProto['write' + name] = numberWriter('write' + name, len);
    });
});

function endianReader(verbs: string[], suffix: string) {
    class EndianReader extends Reader {
        constructor(rd: BaseReader<Buffer>, options: ReaderOptions) {
            super(rd, options);
        }
    }
    NUMBERS.slice(2).forEach(function(pair) {
        verbs.forEach(function(verb) {
            (EndianReader.prototype as any)[verb + pair[0]] = (Reader.prototype as any)[verb + pair[0] + suffix];
        });
    });
    return EndianReader;
}

function endianWriter(verbs: string[], suffix: string) {
    class EndianWriter extends Writer {
        constructor(wr: BaseWriter<Buffer>, options: WriterOptions) {
            super(wr, options);
        }
    }
    NUMBERS.slice(2).forEach(function(pair) {
        verbs.forEach(function(verb) {
            (EndianWriter.prototype as any)[verb + pair[0]] = (Writer.prototype as any)[verb + pair[0] + suffix];
        });
    });
    return EndianWriter;
}

// TODO: add ambient definitions for all generated methods
require('../reader').decorate(Reader.prototype);
require('../writer').decorate(Writer.prototype);
const readerLE = endianReader(['read', 'peek', 'unread'], 'LE');
const readerBE = endianReader(['read', 'peek', 'unread'], 'BE');
const writerLE = endianWriter(['write'], 'LE');
const writerBE = endianWriter(['write'], 'BE');

// Interfaces to get the specialized methods in TypeScript
export interface BinaryReader extends Reader {
    read(len?: number): Promise<Buffer | undefined>;
    readInt8(): Promise<number>;
    peekInt8(): Promise<number>;
    unreadInt8(): void;
    readUInt8(): Promise<number>;
    peekUInt8(): Promise<number>;
    unreadUInt8(): void;
    readInt16(): Promise<number>;
    peekInt16(): Promise<number>;
    unreadInt16(): void;
    readUInt16(): Promise<number>;
    peekUInt16(): Promise<number>;
    unreadUInt16(): void;
    readInt32(): Promise<number>;
    peekInt32(): Promise<number>;
    unreadInt32(): void;
    readUInt32(): Promise<number>;
    peekUInt32(): Promise<number>;
    unreadUInt32(): void;
    readFloat(): Promise<number>;
    peekFloat(): Promise<number>;
    unreadFloat(): void;
    readDouble(): Promise<number>;
    peekDouble(): Promise<number>;
    unreadDouble(): void;
}

export interface BinaryWriter extends Writer {
    writeInt8(val: number): Promise<void>;
    writeUInt8(val: number): Promise<void>;
    writeInt16(val: number): Promise<void>;
    writeUInt16(val: number): Promise<void>;
    writeInt32(val: number): Promise<void>;
    writeUInt32(val: number): Promise<void>;
    writeFloat(val: number): Promise<void>;
    writeDouble(val: number): Promise<void>;
}

// Documentation above, next to the constructor
export function reader(rd: BaseReader<Buffer>, options?: ReaderOptions): BinaryReader {
    options = options || {};
    const constr: any = options.endian === 'little' ? readerLE : readerBE;
    return new constr(rd, options);
}

export function writer(wr: BaseWriter<Buffer>, options?: WriterOptions): BinaryWriter {
    options = options || {};
    const constr: any = options.endian === 'little' ? writerLE : writerBE;
    return new constr(wr, options);
}
