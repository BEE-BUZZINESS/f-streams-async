/// !doc
/// ## Stream transform for CSV files
///
/// `import { csvParser, csvFormatter } from 'f-streams-async'`
///
import { Reader } from '../reader';
import { Writer } from '../writer';
import * as lines from './lines';

/// * `transform = csvParser(options)`
///   creates a parser transform. The following options can be set:
///   - `sep`: the field separator, comma by default
export interface ParserOptions {
    sep?: string;
    encoding?: BufferEncoding;
}

export function parser(options?: ParserOptions) {
    const opts = options || {};
    const sep = opts.sep || ',';
    return async (reader: Reader<string | Buffer>, writer: Writer<any>) => {
        const rd = reader.transform(lines.parser());
        const keys = (await rd.read() || '').split(sep);
        await rd.each(async line => {
            // ignore empty line (we get one at the end if file is terminated by newline)
            if (line.length === 0) return;
            const values = line.split(sep);
            const obj: any = {};
            keys.forEach((key, i) => {
                obj[key] = values[i];
            });
            await writer.write(obj);
        });
    };
}
/// * `transform = csvFormatter(options)`
///   creates a formatter transform. The following options can be set:
///   - `sep`: the field separator, comma by default
///   - `eol`: the end of line marker (`\n`  or `\r\n`)
export interface FormatterOptions {
    sep?: string;
    eol?: string;
}

export function formatter(options?: FormatterOptions) {
    const opts = options || {};
    const sep = opts.sep || ',';
    const eol = opts.eol || '\n';
    return async (reader: Reader<any>, writer: Writer<string>) => {
        let obj = await reader.read();
        if (!obj) return;
        const keys = Object.keys(obj);
        await writer.write(keys.join(sep) + eol);
        do {
            const values = keys.map(key => obj[key]);
            await writer.write(values.join(sep) + eol);
        } while ((obj = await reader.read()) !== undefined);
    };
}
