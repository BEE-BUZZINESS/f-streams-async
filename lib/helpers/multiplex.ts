/// !doc
/// ## helpers for multiplex readers
///
/// `import { multiplexReader } from 'f-streams-async'`
import { Reader } from '../reader';

///
/// ----
///
/// * `reader = multiplexReader(reader)`
///   Wraps raw Buffer readers and returns a reader of these multiple readers.
export function reader(readers: Reader<Buffer>[]): Reader<Reader<Buffer>> {
    let readerIndex = 0;
    return new Reader<Reader<Buffer>>(async () => {
        if (readerIndex >= readers.length) {
            return;
        }
        const partReader = new Reader<Buffer>(async () => {
            return await readers[readerIndex - 1].read();
        });
        partReader.headers = readers[readerIndex].headers;
        readerIndex++;
        return partReader;
    });
}
