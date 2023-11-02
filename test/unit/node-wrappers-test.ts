import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { wait } from 'f-promise-async';
import * as fs from 'fs';
import { nodeReader, nodeWriter } from '../../lib';

chai.use(chaiAsPromised);
const assert = chai.assert;

describe(module.id, () => {
    let tmpDir: string;
    let tmpFilePath: string;
    before(async () => {
        tmpDir = await wait(cb => fs.mkdtemp('/tmp/f-streams-test-', cb));
        tmpFilePath = tmpDir + '/file.data';
    });
    after(async () => {
        await wait(cb => fs.rmdir(tmpDir, cb));
    });

    it('node reader should not clear other listeners', async () => {
        const fsStream = fs.createReadStream(__dirname + '/../../../test/fixtures/rss-sample.xml');
        const reader = nodeReader<Buffer>(fsStream);
        assert.lengthOf(fsStream.rawListeners('error'), 1);

        const customErrorHandler = () => undefined;
        fsStream.on('error', customErrorHandler);
        assert.lengthOf(fsStream.rawListeners('error'), 2);
        assert.include(fsStream.rawListeners('error'), customErrorHandler);

        await reader.stop();

        assert.lengthOf(fsStream.rawListeners('error'), 1);
        assert.include(fsStream.rawListeners('error'), customErrorHandler);
    });

    it.skip('node writer should not clear other listeners', async () => {
        const fsStream = fs.createWriteStream('/tmp/dont-care');
        const writer = nodeWriter<Buffer>(fsStream);
        assert.lengthOf(fsStream.rawListeners('error'), 1);

        const customErrorHandler = () => undefined;
        fsStream.on('error', customErrorHandler);
        assert.lengthOf(fsStream.rawListeners('error'), 2);
        assert.include(fsStream.rawListeners('error'), customErrorHandler);

        await writer.stop();

        assert.lengthOf(fsStream.rawListeners('error'), 1);
        assert.include(fsStream.rawListeners('error'), customErrorHandler);
    });
});
