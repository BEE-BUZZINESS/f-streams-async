import { assert } from 'chai';
import { run, wait } from 'f-promise-async';
import * as fs from 'fs';
import { bufferReader, linesFormatter, linesParser, stringReader, stringWriter, textFileReader } from '../..';

const { equal, ok, strictEqual, deepEqual } = assert;

const inputFile = require('os').tmpdir() + '/jsonInput.json';
const outputFile = require('os').tmpdir() + '/jsonOutput.json';

async function nodeStream(text: string) {
    await wait(cb => fs.writeFile(inputFile, text, 'utf8', cb));
    return textFileReader(inputFile);
}

describe(module.id, () => {
    it('empty', async () => {
        const stream = (await nodeStream('')).transform(linesParser());
        strictEqual(await stream.read(), undefined, 'undefined');
    });

    it('non empty line', async () => {
        const stream = (await nodeStream('a')).transform(linesParser());
        strictEqual(await stream.read(), 'a', 'a');
        strictEqual(await stream.read(), undefined, 'undefined');
    });

    it('only newline', async () => {
        const stream = (await nodeStream('\n')).transform(linesParser());
        strictEqual(await stream.read(), '', 'empty line');
        strictEqual(await stream.read(), undefined, 'undefined');
    });

    it('mixed', async () => {
        const stream = (await nodeStream('abc\n\ndef\nghi')).transform(linesParser());
        strictEqual(await stream.read(), 'abc', 'abc');
        strictEqual(await stream.read(), '', 'empty line');
        strictEqual(await stream.read(), 'def', 'def');
        strictEqual(await stream.read(), 'ghi', 'ghi');
        strictEqual(await stream.read(), undefined, 'undefined');
    });

    it('roundtrip', async () => {
        const writer = stringWriter();
        const text = 'abc\n\ndef\nghi';
        await stringReader(text, 2)
            .transform(linesParser())
            .transform(linesFormatter())
            .pipe(writer);
        strictEqual(writer.toString(), text, text);
    });

    it('binary input', async () => {
        const writer = stringWriter();
        const text = 'abc\n\ndef\nghi';
        await bufferReader(Buffer.from(text, 'utf8'))
            .transform(linesParser())
            .transform(linesFormatter())
            .pipe(writer);
        strictEqual(writer.toString(), text, text);
    });
});
