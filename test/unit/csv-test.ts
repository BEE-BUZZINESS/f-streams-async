import { assert } from 'chai';
import { bufferReader, csvFormatter, csvParser, stringReader, stringWriter } from '../..';

const { equal } = assert;

const legends =
    'firstName,lastName,gender,dob\n' + //
    'Jimi,Hendrix,M,27-11-1942\n' + //
    'Janis,Joplin,F,19-01-1943\n' + //
    'Jim,Morrison,M,08-12-1943\n' + //
    'Kurt,Cobain,M,20-02-1967\n';

describe(module.id, () => {
    it('roundtrip', async () => {
        const sink = stringWriter();
        await stringReader(legends)
            .transform(csvParser())
            .transform(csvFormatter())
            .pipe(sink);
        equal(sink.toString(), legends);
    });

    it('binary input', async () => {
        const sink = stringWriter();
        await bufferReader(Buffer.from(legends, 'utf8'))
            .transform(csvParser())
            .transform(csvFormatter())
            .pipe(sink);
        equal(sink.toString(), legends);
    });
});
