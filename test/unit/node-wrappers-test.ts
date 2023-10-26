import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { wait } from 'f-promise-async';
import { lsof } from 'list-open-files';
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
        await wait(cb => fs.unlink(tmpFilePath, cb));
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

    it('node writer should not clear other listeners', async () => {
        const fsStream = fs.createWriteStream(tmpFilePath);
        const writer = nodeWriter<Buffer>(fsStream);
        assert.lengthOf(fsStream.rawListeners('error'), 1);

        const customErrorHandler = () => undefined;
        fsStream.on('error', customErrorHandler);
        assert.lengthOf(fsStream.rawListeners('error'), 2);
        assert.include(fsStream.rawListeners('error'), customErrorHandler);

        await writer.stop();
        await assertTmpFileNotOpen();

        assert.lengthOf(fsStream.rawListeners('error'), 1);
        assert.include(fsStream.rawListeners('error'), customErrorHandler);
    });

    async function assertTmpFileNotOpen() {
        const openFiles = (await lsof())[0].files;
        const tmpFileOpen = openFiles.find(file => file.name === tmpFilePath);
        assert.isUndefined(tmpFileOpen, `Temporary file ${tmpFilePath} is still open`);
    }
});
