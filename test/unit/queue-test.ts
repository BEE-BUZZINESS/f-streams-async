import { assert } from 'chai';
import { run, wait } from 'f-promise-async';
import { queue } from '../..';

const { equal, ok, strictEqual, deepEqual } = assert;

describe(module.id, () => {
    it('put (lossy)', async () => {
        const q = queue(4);
        for (let i = 0; i < 6; i++) {
            const queued = q.put(i);
            ok(queued === i < 4, 'put return value: ' + queued);
        }
        q.end();
        const result = await q.reader.toArray();
        equal(result.join(','), '0,1,2,3', 'partial queue contents ok');
    });

    it('write (lossless)', async () => {
        const q = queue(4);
        const writeTask = (async () => {
            for (let i = 0; i < 6; i++) await q.write(i);
            await q.write(undefined);
        })();
        const readTask = (async () => {
            return await q.reader.toArray();
        })();

        await wait(writeTask);
        equal((await wait(readTask)).join(','), '0,1,2,3,4,5', 'full queue contents ok');
    });
});
