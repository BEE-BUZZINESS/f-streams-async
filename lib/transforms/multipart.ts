/// !doc
/// ## Stream transform for MIME multipart
///
/// `import { multipartParser, multipartFormatter }from 'f-streams'`
///
import { handshake } from 'f-promise-async';
import * as generic from '../devices/generic';
import * as binary from '../helpers/binary';
import { Reader } from '../reader';
import { Writer } from '../writer';

type MultipartSubType = 'mixed' | 'form-data';

interface MultipartContentType {
    subType: MultipartSubType;
    boundary: string;
}

function parseContentType(contentType?: string): MultipartContentType | null {
    if (!contentType) throw new Error('content-type missing');
    const match = /^multipart\/([\w\-]*)/.exec(contentType);
    if (!match) return null;
    const subType = match[1] as MultipartSubType;
    const atbs: any = contentType.split(/\s*;\s*/).reduce((r: any, s: string) => {
        const kv = s.split(/\s*=\s*/);
        r[kv[0]] = kv[1];
        return r;
    }, {});
    return {
        subType: subType,
        boundary: atbs.boundary,
    };
}

function latin1toUtf8(text: string): string {
    return Buffer.from(text, 'binary').toString('utf8');
}

function mixedParser(ct: MultipartContentType): (reader: Reader<Buffer>, writer: Writer<any>) => Promise<void> {
    const boundary = ct.boundary;
    return async (reader: Reader<Buffer>, writer: Writer<any>) => {
        const binReader = binary.reader(reader);
        const hk = handshake();
        while (true) {
            let partEnded = false;
            const buf = await binReader.readData(2048);
            if (!buf || !buf.length) return;
            const str = buf.toString('binary');
            let i = str.indexOf(boundary);
            if (i < 0) throw new Error('boundary not found');
            const lines = str.substring(0, i).split(/\r?\n/);
            const headers = lines.slice(0, lines.length - 2).reduce((h: any, l: string) => {
                const kv = latin1toUtf8(l).split(/\s*:\s*/);
                h[kv[0].toLowerCase()] = kv[1];
                return h;
            }, {});
            i = str.indexOf('\n', i);
            binReader.unread(buf.length - i - 1);

            const read = async () => {
                if (partEnded) return undefined;
                const len = Math.max(boundary.length, 256);
                const bbuf = await binReader.readData(32 * len);
                if (!bbuf || !bbuf.length) {
                    hk.notify();
                    partEnded = true;
                    return;
                }
                // would be nice if Buffer had an indexOf. Would avoid a conversion to string.
                // I could use node-buffertools but it introduces a dependency on a binary module.
                const s = bbuf.toString('binary');
                const ii = s.indexOf(boundary);
                if (ii === 0) {
                    const j = s.indexOf('\n', boundary.length);
                    if (j < 0) throw new Error('newline missing after boundary');
                    binReader.unread(bbuf.length - j - 1);
                    hk.notify();
                    partEnded = true;
                    return undefined;
                } else if (ii > 0) {
                    let j = s.lastIndexOf('\n', ii);
                    if (s[j - 1] === '\r') j--;
                    binReader.unread(bbuf.length - ii);
                    return bbuf.slice(0, j);
                } else {
                    binReader.unread(bbuf.length - 31 * len);
                    return bbuf.slice(0, 31 * len);
                }
            };
            const partReader = generic.reader(read);
            partReader.headers = headers;
            await writer.write(partReader);
            await hk.wait();
        }
    };
}

function mixedFormatter(ct: MultipartContentType) {
    const boundary = ct.boundary;
    return async (reader: Reader<Reader<Buffer>>, writer: Writer<Buffer>) => {
        let part: Reader<Buffer> | undefined;
        while ((part = await reader.read()) !== undefined) {
            const headers = part.headers;
            if (!headers) throw new Error('part does not have headers');
            for (const key of Object.keys(part.headers)) {
                await writer.write(Buffer.from(key + ': ' + headers[key] + '\n', 'utf8'));
            }
            await writer.write(Buffer.from('\n' + boundary + '\n'));
            // cannot use pipe because pipe writes undefined at end.
            await part.each(async data => {
                await writer.write(data);
            });
            await writer.write(Buffer.from('\n' + boundary + '\n'));
        }
    };
}

function formDataParser(ct: MultipartContentType): (reader: Reader<Buffer>, writer: Writer<any>) => Promise<void> {
    const boundary = '--' + ct.boundary;
    return async (reader: Reader<Buffer>, writer: Writer<any>) => {
        const binReader = binary.reader(reader);
        const hk = handshake();
        while (true) {
            let partEnded = false;
            const buf = await binReader.readData(2048);
            if (!buf || !buf.length) return;
            const str = buf.toString('binary');

            let endBoundaryIndex = str.indexOf(boundary) + boundary.length;
            if (endBoundaryIndex < 0) throw new Error('boundary not found');

            if (str.charAt(endBoundaryIndex) === '\r') {
                endBoundaryIndex++;
            }
            if (str.charAt(endBoundaryIndex) === '\n') {
                endBoundaryIndex++;
            }

            if (str.indexOf(boundary + '--') === 0) {
                return;
            }

            const endOfHeaders = str.substring(endBoundaryIndex).search(/\r?\n\r?\n/) + endBoundaryIndex;

            const lines = str.substring(endBoundaryIndex, endOfHeaders).split(/\r?\n/);
            const headers = lines.slice(0, lines.length).reduce((h: any, l: string) => {
                const kv = latin1toUtf8(l).split(/\s*:\s*/);
                h[kv[0].toLowerCase()] = kv[1];
                return h;
            }, {});

            let beginOfData = endOfHeaders;
            if (str.charAt(beginOfData) === '\r') {
                beginOfData++;
            }
            if (str.charAt(beginOfData) === '\n') {
                beginOfData++;
            }
            if (str.charAt(beginOfData) === '\r') {
                beginOfData++;
            }
            if (str.charAt(beginOfData) === '\n') {
                beginOfData++;
            }

            binReader.unread(buf.length - beginOfData);

            const read = async () => {
                if (partEnded) return undefined;
                const len = Math.max(boundary.length, 256);
                const bbuf = await binReader.readData(32 * len);
                if (!bbuf || !bbuf.length) {
                    // conditional notify: allow final read to be called twice
                    if (!partEnded) {
                        partEnded = true;
                        hk.notify();
                    }
                    return undefined;
                }
                // would be nice if Buffer had an indexOf. Would avoid a conversion to string.
                // I could use node-buffertools but it introduces a dependency on a binary module.
                const s = bbuf.toString('binary');
                const indexOfBoundaryInPart = s.indexOf(boundary);

                if (indexOfBoundaryInPart === 0) {
                    binReader.unread(bbuf.length);
                    // conditional notify: allow final read to be called twice
                    if (!partEnded) {
                        partEnded = true;
                        hk.notify();
                    }
                    return undefined;
                } else if (indexOfBoundaryInPart > 0) {
                    let r = 0;
                    if (s[indexOfBoundaryInPart - 2] === '\r') {
                        r++;
                    }
                    binReader.unread(bbuf.length - indexOfBoundaryInPart);
                    return bbuf.slice(0, indexOfBoundaryInPart - 1 - r);
                } else {
                    binReader.unread(bbuf.length - 31 * len);
                    return bbuf.slice(0, 31 * len);
                }
            };
            const partReader = generic.reader(read);
            partReader.headers = headers;
            await writer.write(partReader);
            await hk.wait();
        }
    };
}

function formDataFormatter(ct: MultipartContentType): (reader: Reader<Reader<Buffer>>, writer: Writer<Buffer>) => Promise<void> {
    const boundary = '--' + ct.boundary;
    if (!boundary) throw new Error('multipart boundary missing');
    const CR_LF = '\r\n';

    return async (reader: Reader<Reader<Buffer>>, writer: Writer<Buffer>) => {
        let part: Reader<any> | undefined;
        while ((part = await reader.read()) !== undefined) {
            await writer.write(Buffer.from(boundary + CR_LF));

            const headers = part.headers;
            if (!headers) throw new Error('part does not have headers');
            for (const key of Object.keys(part.headers)) {
                await writer.write(Buffer.from(key + ': ' + headers[key] + CR_LF, 'utf8'));
            }
            // cannot use pipe because pipe writes undefined at end.;
            await writer.write(Buffer.from(CR_LF));
            await part.each(async data => {
                await writer.write(data);
            });
            await writer.write(Buffer.from(CR_LF));
        }
        await writer.write(Buffer.from(boundary + '--'));
    };
}

/// * `transform = multipartParser(options)`
///   Creates a parser transform.
///   The content type, which includes the boundary,
///   is passed via `options['content-type']`.
export type ParserOptions = {
    [name: string]: string;
};

export function parser(options: ParserOptions): (reader: Reader<Buffer>, writer: Writer<any>) => Promise<void> {
    const ct = parseContentType(options && options['content-type']);
    if (!ct || !ct.boundary) throw new Error('multipart boundary missing');

    const multipartType = (ct && ct.subType) || 'mixed';
    switch (multipartType) {
        case 'mixed':
            return mixedParser(ct);
        case 'form-data':
            return formDataParser(ct);
        default:
            throw new Error(`Unhandled multipart subtype: ${multipartType}`);
    }
}

/// * `transform = multipartFormatter(options)`
///   Creates a formatter transform.
///   The content type, which includes the boundary,
///   is passed via `options['content-type']`.
export interface FormatterOptions {
    [name: string]: string;
}

export function formatter(
    options?: FormatterOptions,
): (reader: Reader<Reader<Buffer>>, writer: Writer<Buffer>) => Promise<void> {
    const ct = parseContentType(options && options['content-type']);
    if (!ct || !ct.boundary) throw new Error('multipart boundary missing');

    const multipartType = (ct && ct.subType) || 'mixed';
    switch (multipartType) {
        case 'mixed':
            return mixedFormatter(ct);
        case 'form-data':
            return formDataFormatter(ct);
        default:
            throw new Error(`Unhandled multipart subtype: ${multipartType}`);
    }
}
