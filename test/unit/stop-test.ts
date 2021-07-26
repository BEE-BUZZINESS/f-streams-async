import { assert } from 'chai';
import { run, wait } from 'f-promise-async';
import { arrayWriter, genericReader, Reader } from '../..';
import { nextTick } from '../../lib/util';

const { equal, ok, strictEqual, deepEqual } = assert;

interface TestReader extends Reader<number> {
    stoppedReason?: {
        at: number;
        arg: any;
    };
}

function numbers(limit: number): TestReader {
    let i = 0;
    return genericReader(
        async function read(this: TestReader) {
            await nextTick();
            if (this.stoppedReason) throw new Error('attempt to read after stop: ' + i);
            return i >= limit ? undefined : i++;
        },
        async function stop(this: TestReader, arg: any) {
            this.stoppedReason = {
                at: i,
                arg: arg,
            };
        },
    ) as TestReader;
}

describe(module.id, () => {
    it('explicit stop', async () => {
        const source = numbers(100);
        let result = '';
        for (let i = 0; i < 5; i++) result += await source.read();
        await source.stop();
        strictEqual(result, '01234');
        strictEqual(source.stoppedReason && source.stoppedReason.at, 5);
    });

    it('explicit stop with err', async () => {
        const source = numbers(100);
        let result = '';
        for (let i = 0; i < 5; i++) result += await source.read();
        const err = new Error('testing');
        await source.stop(err);
        strictEqual(result, '01234');
        strictEqual(source.stoppedReason && source.stoppedReason.arg, err);
    });

    // limit exercises transform
    it('limit stops', async () => {
        const source = numbers(100);
        const result = (await source
            .skip(2)
            .limit(5)
            .toArray())
            .join(',');
        strictEqual(result, '2,3,4,5,6');
        ok(source.stoppedReason, 'stopped');
    });

    it('concat stops', async () => {
        const source1 = numbers(5);
        const source2 = numbers(5);
        const source3 = numbers(5);
        const result = (await source1
            .concat([source2, source3])
            .limit(7)
            .toArray())
            .join(',');
        strictEqual(result, '0,1,2,3,4,0,1');
        ok(!source1.stoppedReason, 'source1 not stopped');
        ok(source2.stoppedReason, 'source2 stopped');
        ok(source3.stoppedReason, 'source3 stopped');
    });

    it('dup stops on 0 and continues on 1', async () => {
        const source = numbers(5);
        const dups = source.dup();
        const resultF = dups[0].limit(2).toArray();
        const altF = dups[1].toArray();
        const result = (await resultF).join();
        const alt = (await altF).join();
        strictEqual(result, '0,1');
        strictEqual(alt, '0,1,2,3,4');
        ok(!source.stoppedReason, 'source not stopped');
    });

    it('dup stops on 1 and continues on 0', async () => {
        const source = numbers(5);
        const dups = source.dup();
        const resultF = dups[1].limit(2).toArray();
        const altF = dups[0].toArray();
        const result = (await resultF).join();
        const alt = (await altF).join();
        strictEqual(result, '0,1');
        strictEqual(alt, '0,1,2,3,4');
        ok(!source.stoppedReason, 'source not stopped');
    });

    it('dup stops both silently from 0', async () => {
        const source = numbers(5);
        const dups = source.dup();
        const resultF = dups[0].limit(2, true).toArray();
        const altF = dups[1].toArray();
        const result = (await resultF).join();
        const alt = (await altF).join();
        strictEqual(result, '0,1');
        strictEqual(alt, '0,1,2'); // 2 is already queued when we hit limit
        ok(source.stoppedReason, 'source stopped');
    });

    it('dup stops both silently from 1', async () => {
        const source = numbers(5);
        const dups = source.dup();
        const resultF = dups[1].limit(2, true).toArray();
        const altF = dups[0].toArray();
        const result = (await resultF).join();
        const alt = (await altF).join();
        strictEqual(result, '0,1');
        strictEqual(alt, '0,1,2'); // 2 is already queued when we hit limit
        ok(source.stoppedReason, 'source stopped');
    });

    it('dup stops with error from 0', async () => {
        const source = numbers(5);
        const dups = source.dup();
        const resultF = dups[0].limit(2, new Error('testing')).toArray();
        const altF = dups[1].toArray();
        const result = (await resultF).join();
        try {
            const alt = (await altF).join();
            ok(false, 'altF did not throw');
        } catch (ex) {
            strictEqual(ex.message, 'testing');
        }
        strictEqual(result, '0,1');
        ok(source.stoppedReason, 'source stopped');
    });

    it('dup stops with error from 1', async () => {
        const source = numbers(5);
        const dups = source.dup();
        const resultF = dups[1].limit(2, new Error('testing')).toArray();
        const altF = dups[0].toArray();
        const result = (await resultF).join();
        try {
            const alt = (await altF).join();
            ok(false, 'altF did not throw');
        } catch (ex) {
            strictEqual(ex.message, 'testing');
        }
        strictEqual(result, '0,1');
        ok(source.stoppedReason, 'source stopped');
    });

    it('dup stops 0 first, 1 later', async () => {
        const source = numbers(10);
        const dups = source.dup();
        const resultF = dups[0].limit(2).toArray();
        const altF = dups[1].limit(5).toArray();
        const result = (await resultF).join();
        const alt = (await altF).join();
        strictEqual(result, '0,1');
        strictEqual(alt, '0,1,2,3,4');
        ok(source.stoppedReason, 'source stopped');
    });

    it('dup stops 1 first, 0 later', async () => {
        const source = numbers(10);
        const dups = source.dup();
        const resultF = dups[1].limit(2).toArray();
        const altF = dups[0].limit(5).toArray();
        const result = (await resultF).join();
        const alt = (await altF).join();
        await wait(cb => setTimeout(cb, 0));
        strictEqual(result, '0,1');
        strictEqual(alt, '0,1,2,3,4');
        ok(source.stoppedReason, 'source stopped');
    });

    it('pre', async () => {
        const source = numbers(10);
        const target = arrayWriter<number>();
        await source.pipe(await target.pre.limit(5));
        strictEqual(target.toArray().join(), '0,1,2,3,4');
        ok(source.stoppedReason, 'source stopped');
    });
});
