import { assert } from 'chai';
import { wait } from 'f-promise-async';
import * as fs from 'fs';
import { lsof } from 'list-open-files';
import { binaryFileReader, binaryFileWriter, genericReader, textFileReader, textFileWriter } from '../..';

const { ok, strictEqual } = assert;

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

    async function writeBinaryFile(filePath: string, nbChunk32k: number) {
        let chunkIndex = 0;
        const writer = binaryFileWriter(filePath);
        await genericReader<Buffer>(async () => {
            if (chunkIndex === nbChunk32k) {
                return;
            }
            chunkIndex++;
            return Buffer.alloc(32 * 1024);
        }).pipe(writer);
    }

    async function writeTextFile(filePath: string, nbChunk32k: number) {
        let chunkIndex = 0;
        const writer = textFileWriter(filePath);
        await genericReader<string>(async () => {
            if (chunkIndex === nbChunk32k) {
                return;
            }
            chunkIndex++;
            return Buffer.alloc(32 * 1024).toString();
        }).pipe(writer);
    }

    async function assertTmpFileNotOpen() {
        const openFiles = (await lsof())[0].files;
        const tmpFileOpen = openFiles.find(file => file.name === tmpFilePath);
        assert.isUndefined(tmpFileOpen, `Temporary file ${tmpFilePath} is still open`);
    }

    describe('binaryFileWriter', () => {

        afterEach(async () => {
            await wait(cb => fs.unlink(tmpFilePath, cb));
        });

        it('end() should close fd', async () => {
            await writeBinaryFile(tmpFilePath, 4);

            await assertTmpFileNotOpen();
        });

        it('stop() should close fd', async () => {
            let chunkIndex = 0;

            const writer = binaryFileWriter(tmpFilePath);
            try {
                await genericReader<Buffer>(async () => {
                    if (chunkIndex === 3) {
                        throw new Error('file troncated');
                    }
                    chunkIndex++;
                    return Buffer.alloc(32 * 1024);
                }).pipe(writer);
            } catch (e) {
                await writer.stop(e);
            }

            await assertTmpFileNotOpen();
        });
    });

    describe('binaryFileReader', async () => {
        before(async () => {
            await writeBinaryFile(tmpFilePath, 4);
        });

        after(async () => {
            await wait(cb => fs.unlink(tmpFilePath, cb));
        });

        it('end() should close fd', async () => {
            await binaryFileReader(tmpFilePath).readAll();

            await assertTmpFileNotOpen();
        });

        it('stop() should close fd', async () => {
            const reader = binaryFileReader(tmpFilePath);
            try {
                await reader.each(async (chunk: Buffer, index: number) => {
                    if (index === 1) {
                        await reader.stop(new Error('read stream error'));
                        return;
                    }
                });
                ok(false);
            } catch (ex) {
                strictEqual(ex.message, 'read stream error');
            }

            await assertTmpFileNotOpen();
        });
    });

    describe('textFileWriter', async () => {

        afterEach(async () => {
            await wait(cb => fs.unlink(tmpFilePath, cb));
        });

        it('end() should close fd', async () => {
            await writeTextFile(tmpFilePath, 4);

            await assertTmpFileNotOpen();
        });

        it('stop() should close fd', async () => {
            let chunkIndex = 0;

            const writer = textFileWriter(tmpFilePath);
            try {
                await genericReader<string>(async () => {
                    if (chunkIndex === 3) {
                        throw new Error('file troncated');
                    }
                    chunkIndex++;
                    return Buffer.alloc(32 * 1024).toString();
                }).pipe(writer);
            } catch (e) {
                await writer.stop(e);
            }

            await assertTmpFileNotOpen();
        });
    });

    describe('textFileReader', () => {
        before(async () => {
            await writeTextFile(tmpFilePath, 4);
        });

        after(async () => {
            await wait(cb => fs.unlink(tmpFilePath, cb));
        });

        it('end() should close fd', async () => {
            await textFileReader(tmpFilePath).readAll();

            await assertTmpFileNotOpen();
        });

        it('stop() should close fd', async () => {
            const reader = textFileReader(tmpFilePath);
            try {
                await reader.each(async (chunk: string, index: number) => {
                    if (index === 1) {
                        await reader.stop(new Error('read stream error'));
                        return;
                    }
                });
                ok(false);
            } catch (ex) {
                strictEqual(ex.message, 'read stream error');
            }

            await assertTmpFileNotOpen();
        });
    });
});
