import * as chai from 'chai';
import * as path from 'path';
import * as chaiAsPromised from 'chai-as-promised';
import { sleep, wait } from 'f-promise-async';
import { lsof } from 'list-open-files';
import * as fs from 'fs';
import { nodeReader, nodeWriter } from '../../lib';
import { Readable, Writable } from 'stream';

chai.use(chaiAsPromised);
const assert = chai.assert;

describe(module.id, () => {
    async function assertOtherEventListener(emitter: Writable | Readable, action: () => Promise<void>) {
        assert.lengthOf(emitter.rawListeners('error'), 1);

        const customErrorHandler = () => undefined;
        emitter.on('error', customErrorHandler);
        assert.lengthOf(emitter.rawListeners('error'), 2);
        assert.include(emitter.rawListeners('error'), customErrorHandler);

        await action();
        await sleep(10);

        assert.lengthOf(emitter.rawListeners('error'), 1);
        assert.include(emitter.rawListeners('error'), customErrorHandler);
        assert.isTrue(emitter.closed);
    }

    describe('fs node stream', () => {
        let tmpDir: string;
        let tmpFilePath: string;
        const existingFilePath = path.resolve(__dirname + '/../../../test/fixtures/rss-sample.xml');
        before(async () => {
            tmpDir = await wait(cb => fs.mkdtemp('/tmp/f-streams-test-', cb));
            tmpFilePath = tmpDir + '/file.data';
        });
        after(async () => {
            await wait(cb => fs.unlink(tmpFilePath, cb)).catch(() => undefined);
            await wait(cb => fs.rmdir(tmpDir, cb));
        });

        it('node reader end should not clear other listeners', async () => {
            const fsStream = fs.createReadStream(existingFilePath);
            const reader = nodeReader<Buffer>(fsStream);
    
            await assertOtherEventListener(fsStream, async () => {
                await reader.readAll();
            });
            await assertFileNotOpen(existingFilePath);
        });
    
        it('node reader stop should not clear other listeners', async () => {
            const fsStream = fs.createReadStream(existingFilePath);
            const reader = nodeReader<Buffer>(fsStream);
    
            await assertOtherEventListener(fsStream, async () => {
                await reader.stop();
            });
            await assertFileNotOpen(existingFilePath);
        });
    
        it('node writer end should not clear other listeners', async () => {
            const fsStream = fs.createWriteStream(tmpFilePath);
            const writer = nodeWriter<Buffer>(fsStream);
    
            await assertOtherEventListener(fsStream, async () => {
                await writer.write(undefined);
            });
            await assertFileNotOpen(existingFilePath);
        });
    
        it('node writer stop should not clear other listeners', async () => {
            const fsStream = fs.createWriteStream(tmpFilePath);
            const writer = nodeWriter<Buffer>(fsStream);
    
            await assertOtherEventListener(fsStream, async () => {
                await writer.stop();
            });
            await assertFileNotOpen(existingFilePath);
        });

        async function assertFileNotOpen(filename: string) {
            const openFiles = (await lsof())[0].files;
            const tmpFileOpen = openFiles.find(file => file.name === filename);
            assert.isUndefined(tmpFileOpen, `Temporary file ${filename} is still open`);
        }
    });
    
    describe('custom node stream', () => {

        it('node writer stop should not clear other listeners', async () => {
            const numberConsumeStream = new Writable({
                write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
                    callback();
                },
            });
            const writer = nodeWriter<Buffer>(numberConsumeStream);

            await assertOtherEventListener(numberConsumeStream, async () => {
                await writer.stop();
            });
        });

        it('node writer error should not clear other listeners', async () => {
            const numberConsumeStream = new Writable({
                write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
                    callback(new Error('hello'));
                },
            });
            const writer = nodeWriter<Buffer>(numberConsumeStream);

            await assertOtherEventListener(numberConsumeStream, async () => {
                await writer.write(Buffer.alloc(12)).catch(e => console.log(`write error: ${e.message}`));
            });
        });

        it('node reader end should not clear other listeners', async () => {
            const numberConsumeStream = new Readable({
                read(size?: number) {
                    this.push(null);
                },
            });
            const reader = nodeReader<number>(numberConsumeStream);

            await assertOtherEventListener(numberConsumeStream, async () => {
                await reader.readAll();
            });
        });

        it('node reader stop should not clear other listeners', async () => {
            const numberConsumeStream = new Readable({
                read(size?: number) {
                    this.push(null);
                },
            });
            const reader = nodeReader<number>(numberConsumeStream);

            await assertOtherEventListener(numberConsumeStream, async () => {
                await reader.stop();
            });
        });

        it('node reader error should not clear other listeners', async () => {
            const numberConsumeStream = new Readable({
                read(size?: number) {
                    this.destroy(new Error('hello'));
                },
            });
            const reader = nodeReader<number>(numberConsumeStream);

            await assertOtherEventListener(numberConsumeStream, async () => {
                await reader.readAll().catch(e => console.log(`read error: ${e.message}`));
            });
        });
    });
});
