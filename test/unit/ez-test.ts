import { assert } from 'chai';
import { cutter, emptyReader, HttpServer, httpServer, reader as fReader, writer as fWriter } from '../..';
import { createEmptyReader, createEmptyWriter } from '../../lib';

const { ok, strictEqual, deepEqual } = assert;

let server: HttpServer;

describe(module.id, () => {
    it('start echo server', async () => {
        server = httpServer(async function(req, res) {
            if (req.method === 'POST') {
                const text = await req.readAll();
                const ct = req.headers['content-type'];
                if (ct === 'application/json') {
                    res.writeHead(201, {
                        'content-type': ct,
                    });
                    res.end('{"echo":' + text + '}');
                } else {
                    res.writeHead(201);
                    res.end(ct + ': ' + text);
                }
            }
            if (req.method === 'GET') {
                // query parameters
                const query = (req.url.split('?')[1] || '').split('&').reduce(
                    function(prev, crt) {
                        const parts = crt.split('=');
                        if (parts[0]) prev[parts[0]] = parts[1];
                        return prev;
                    },
                    {} as any,
                );
                res.writeHead(query.status || 200, {});
                res.end('reply for GET');
            }
        });
        await server.listen(3005);
        ok(true, 'server started');
    });

    it('http test', async () => {
        const reply = await fReader('http://localhost:3005').readAll();
        strictEqual(reply, 'reply for GET', 'Get test: reader ok');
        // try not found reader
        try {
            const reply404 = await fReader('http://localhost:3005?status=404').readAll();
            ok(false, 'Reader supposed to throw');
        } catch (ex) {
            ok(/Status 404/.test(ex.message), 'Reader throws ok');
        }
    });

    it('http readers and writers', async () => {
        const writer = fWriter('http://localhost:3005');
        const result = (await writer.writeAll('hello world')).result;
        strictEqual(result, 'text/plain: hello world');
    });

    it('http JSON', async () => {
        const writer = fWriter('http://localhost:3005');
        const result = (await writer.writeAll([2, 4])).result;
        deepEqual(result, { echo: [2, 4] });
    });

    it('array test', async () => {
        const reply = await fReader([2, 3, 4]).readAll();
        deepEqual(reply, [2, 3, 4]);
    });

    it('array readers and writers', async () => {
        const writer = fWriter([]);
        await fReader([2, 3, 4]).pipe(writer);
        deepEqual(writer.result, [2, 3, 4]);
    });

    it('string test', async () => {
        const reply = await fReader('string:hello world').readAll();
        deepEqual(reply, 'hello world');
    });

    it('string readers and writers', async () => {
        const writer = fWriter('string:');
        await fReader('string:hello world').pipe(writer);
        deepEqual(writer.result, 'hello world');
    });

    it('buffer test',async  () => {
        const buf = Buffer.from('hello world', 'utf8');
        const reply = await fReader(buf)
            .transform(cutter(2))
            .readAll() as Buffer;
        deepEqual(reply.toString('utf8'), buf.toString('utf8'));
    });

    it('buffer reader and writer', async () => {
        const buf = Buffer.from('hello world', 'utf8');
        const writer = fWriter(Buffer.alloc(0));
        const reply = await fReader(buf).pipe(writer);
        deepEqual(writer.result.toString('utf8'), buf.toString('utf8'));
    });

    it('emptyReader should be usable many times', async () => {
        assert.isUndefined(await emptyReader.readAll());
        assert.isUndefined(await emptyReader.readAll());
    });

    it('createEmptyReader() should be usable many times', async () => {
        assert.isUndefined(await createEmptyReader().readAll());
        assert.isUndefined(await createEmptyReader().readAll());
    });

    it('createEmptyWriter() should be usable many times', async () => {
        try {
            await fReader('string:hello world').pipe(createEmptyWriter());
            await fReader([2, 3, 4]).pipe(createEmptyWriter());
        } catch {
            ok(false)
        }
    });
});
