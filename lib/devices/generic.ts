import { Reader } from '../reader';
import { Writer } from '../writer';

/// ## Special streams
///
/// `import { emptyReader, emptyWriter } from 'f-streams'`
///
/// * `emptyReader` deprecated, use emptySourceReader()
/// * `emptyWriter` deprecated, use emptySinkWriter()
///   Empty streams. `emptySourceReader().read()` returns `undefined`.
///   `emptySinkWriter()` create a null sink. It just discards anything you would write to it.
export const empty = {
    reader: new Reader(function(this: Reader<any>) {}),
    writer: new Writer(function(this: Writer<any>, value: any) {}),
    source: () => new Reader(function(this: Reader<any>) {}),
    sink: () => new Writer(function(this: Writer<any>, value: any) {}),
};

/// !doc
/// ## Generic stream constructors
///
/// `import { genericReader, genericWriter } from 'f-streams'`
///
/// * `reader = genericReader(read[, stop])`
///   creates a reader from a given `read()` function and an optional `stop([arg])` function.
export function reader<T>(read: () => T | undefined, stop?: (arg?: any) => void) {
    return new Reader<T>(read, stop);
}

/// * `writer = genericWriter(write)`
///   creates a writer from a given `write(val)` function.
export function writer<T>(write: (value: T | undefined) => void, stop?: (arg?: any) => void) {
    return new Writer<T>(write, stop);
}
