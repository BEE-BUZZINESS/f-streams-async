import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { binaryFileReader, cutter, Reader, stringConverter, stringWriter, textFileReader, Writer } from '../..';

chai.use(chaiAsPromised);
const { equal, isRejected } = chai.assert;

const sample = __dirname + '/../../../test/fixtures/rss-sample.xml';
const zlib = require('zlib');

describe(module.id, () => {
    it('gzip roundtrip', async () => {
        const sampleReader1 = textFileReader(sample);
        let sampleReader2 = textFileReader(sample);
        const stringify = stringConverter();
        const cut = cutter(10);
        sampleReader2 = sampleReader2
            .nodeTransform(zlib.createGzip())
            .nodeTransform(zlib.createGunzip())
            .map(stringify);
        const cmp = await sampleReader1.transform(cut).compare(sampleReader2.transform(cut));
        equal(cmp, 0);
    });
    it('writer nodify', async () => {
        const sampleReader1 = textFileReader(sample);
        const sampleReader2 = textFileReader(sample);
        const dest = stringWriter();
        const expected = (await sampleReader2.toArray()).join('');
        const piped = await sampleReader1.nodify().pipe(dest.nodify());
        piped.on('finish', function() {
            equal(dest.toString(), expected);
        });
    });
    it('nodeTransform error chain', async () => {
        const tranformFn = (shouldThrow: boolean) => {
            return async (reader: Reader<Buffer>, writer: Writer<Buffer>): Promise<void> => {
                if (shouldThrow) throw new Error('Error chain');
                const transformer = zlib.createGzip();
                await reader.nodeTransform(transformer).pipe(writer);
            };
        };

        const r1 = binaryFileReader(sample);
        const r3 = await r1.transform(tranformFn(true));
        const r4 = await r3.transform(tranformFn(false));
        await isRejected(r4.readAll(), 'Error chain');
    });
});
