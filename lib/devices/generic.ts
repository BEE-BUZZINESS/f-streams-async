import { Reader } from '../reader';
import { Writer } from '../writer';

/// ## Special streams
///
/// `import { emptyReader, emptyWriter } from 'f-streams-async'`
///
/// * `emptyReader` deprecated, use createEmptyReader()
/// * `emptyWriter` deprecated, use createEmptyWriter()
///   Empty streams. `createEmptyReader().read()` returns `undefined`.
///   `createEmptyWriter()` create a null sink. It just discards anything you would write to it.
export const empty = {
    reader: new Reader(async function(this: Reader<any>) {}),
    writer: new Writer(async function(this: Writer<any>, value: any) {}),
    createReader: () => new Reader(async function(this: Reader<any>) {}),
    createWriter: () => new Writer(async function(this: Writer<any>, value: any) {}),
};

/// !doc
/// ## Generic stream constructors
///
/// `import { genericReader, genericWriter } from 'f-streams-async'`
///
/// * `reader = genericReader(read[, stop])`
///   creates a reader from a given `read()` function and an optional `stop([arg])` function.
export function reader<T>(read: () => Promise<T | undefined>, stop?: (arg?: any) => Promise<void>) {
    return new Reader<T>(read, stop);
}

/// * `writer = genericWriter(write)`
///   creates a writer from a given `write(val)` function.
export function writer<T>(write: (value: T | undefined) => Promise<Writer<T> | void>, stop?: (arg?: any) => Promise<Writer<T> | void>) {
    return new Writer<T>(write, stop);
}
