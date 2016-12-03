import * as ez from "../..";
import { assert } from 'chai';
import { run, wait } from 'f-promise';
import { setup } from 'f-mocha';
setup();

const { equal, ok, strictEqual, deepEqual } = assert;

describe(module.id, () => {
    it("put (lossy)", () => {
        const queue = ez.devices.queue.create(4);
        for (var i = 0; i < 6; i++) {
            var queued = queue.put(i);
            ok(queued === (i < 4), "put return value: " + queued);
        }
        queue.end();
        const result = queue.reader.toArray();
        equal(result.join(','), "0,1,2,3", 'partial queue contents ok');
    });

    it("write (lossless)", () => {
        const queue = ez.devices.queue.create(4);
        const writeTask = run(() => {
            for (var i = 0; i < 6; i++) queue.write(i);
            queue.write(undefined);
        });
        const readTask = run(() => {
            return queue.reader.toArray();
        });

        wait(writeTask);
        equal(wait(readTask).join(','), "0,1,2,3,4,5", 'full queue contents ok');
    });
});