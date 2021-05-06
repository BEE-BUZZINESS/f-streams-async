import { assert } from 'chai';
import { binaryReader, binaryWriter, bufferReader, bufferWriter, cutter, genericReader, genericWriter } from '../..';

const { equal } = assert;

const TESTBUF = Buffer.from([1, 4, 9, 16, 25, 36, 49, 64, 81, 100]);

function eqbuf(b1: Buffer | undefined, b2: Buffer, msg: string) {
    if (!b1) throw new Error('unexpected EOF');
    equal(b1.toString('hex'), b2.toString('hex'), msg);
}

describe(module.id, async () => {
    it('roundtrip', () => {
        [1, 4, 11, 1000].forEach(async function(size) {
            const dst = bufferWriter();
            const writer = binaryWriter(dst, {
                bufSize: size,
            });
            await writer.write(TESTBUF);
            await writer.writeInt8(1);
            await writer.writeUInt8(254);
            await writer.writeInt16(2);
            await writer.writeInt32(3);
            await writer.writeFloat(0.5);
            await writer.writeDouble(0.125);
            await writer.writeInt8(5);
            await writer.write();
            const result = dst.toBuffer();

            const src = bufferReader(result).transform<Buffer>(cutter(5));
            const reader = binaryReader(src);
            eqbuf(await reader.read(7), TESTBUF.slice(0, 7), 'read 7 (size=' + size + ')');
            reader.unread(3);
            eqbuf(await reader.peek(5), TESTBUF.slice(4, 9), 'unread 3 then peek 5');
            eqbuf(await reader.read(6), TESTBUF.slice(4), 'read 6');
            equal(await reader.readInt8(), 1, 'int8 roundtrip');
            equal(await reader.readUInt8(), 254, 'uint8 roundtrip');
            equal(await reader.peekInt16(), 2, 'int16 roundtrip (peek)');
            equal(await reader.readInt16(), 2, 'int16 roundtrip');
            equal(await reader.readInt32(), 3, 'int32 roundtrip');
            equal(await reader.readFloat(), 0.5, 'float roundtrip');
            equal(await reader.peekDouble(), 0.125, 'double roundtrip (peek)');
            equal(await reader.readDouble(), 0.125, 'double roundtrip');
            reader.unreadDouble();
            equal(await reader.readDouble(), 0.125, 'double roundtrip (after unread)');
            equal(await reader.readInt8(), 5, 'int8 roundtrip again');
            equal(await reader.read(), undefined, 'EOF roundtrip');
        });
    });

    describe('peekAll should not consume the reader', async () => {
        it('buffer is empty', async () => {
            const originalBuffer = Buffer.from([]);
            const reader = binaryReader(bufferReader(originalBuffer));
            equal(await reader.peekAll(), undefined, 'peekAll');
            equal(await reader.readAll(), undefined, 'readAll');
        });

        it('buffer length smaller than chunk size', async () => {
            const originalBuffer = Buffer.allocUnsafe(256);
            const reader = binaryReader(bufferReader(originalBuffer));
            eqbuf(await reader.peekAll(), originalBuffer, 'peekAll');
            eqbuf((await reader.readAll() as Buffer), originalBuffer, 'readAll');
        });

        it('buffer length equal to chunk size', async () => {
            const originalBuffer = Buffer.allocUnsafe(1024);
            const reader = binaryReader(bufferReader(originalBuffer));
            eqbuf(await reader.peekAll(), originalBuffer, 'peekAll');
            eqbuf((await reader.readAll() as Buffer), originalBuffer, 'readAll');
        });

        it('buffer length greater than chunk size', async () => {
            const originalBuffer = Buffer.allocUnsafe(1600);
            const reader = binaryReader(bufferReader(originalBuffer));
            eqbuf(await reader.peekAll(), originalBuffer, 'peekAll');
            eqbuf((await reader.readAll() as Buffer), originalBuffer, 'readAll');
        });
    });

    it('should stop underlying reader', async () => {
        const stopError = new Error('stop read stream');
        let foundError: Error | undefined;
        await binaryReader(genericReader<Buffer>(async () => {
            return Buffer.allocUnsafe(1);
        }, async (e: Error) => {
            foundError = e;
        })).stop(stopError);
        assert.equal(foundError, stopError);
    });

    it('should stop underlying writer', async () => {
        const stopError = new Error('stop write stream');
        let foundError: Error | undefined;
        await binaryWriter(genericWriter<Buffer>(async () => {
            return ;
        }, async (e: Error) => {
            foundError = e;
        })).stop(stopError);
        assert.equal(foundError, stopError);
    });
});
