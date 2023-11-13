import { assert } from 'chai';
import * as http from 'http';
import { factory, HttpServer, httpServer } from '../..';
import { httpClient, HttpClientRequest } from '../../lib';

const { equal, ok, strictEqual, deepEqual } = assert;

let server: HttpServer;

describe(module.id, () => {
    before(async () => {
        server = httpServer(async function (req, res) {
            if (req.method === 'POST') {
                const text = await req.readAll();
                res.statusCode = 201;
                res.end(req.headers['content-type'] + text);
            }
            if (req.method === 'GET') {
                // query parameters
                const query = (req.url.split('?')[1] || '').split('&').reduce(
                    function (prev, crt) {
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
        await server.listen(3004);
    });

    after(async () => {
        await server.close();
    });

    it('Echo service test', async () => {
        async function _test(type: string, message: any) {
            const writer = await factory('http://localhost:3004').writer();
            await writer.write(message);
            strictEqual(
                await writer.write(undefined),
                type + (type === 'application/json' ? JSON.stringify(message) : message),
                'POST result ok for ' + type,
            );
        }
        await _test('text/plain', 'post test');
        await _test('application/json', { test: 'post test' });
        await _test('text/html', '<!DOCTYPE html>');
        await _test('application/xml', '<xml ns');
        //
        const reader = await factory('http://localhost:3004').reader();
        strictEqual(await reader.read(), 'reply for GET', 'Get test: reader ok');
        // try not found reader
        try {
            const nfReader = await factory('http://localhost:3004?status=404').reader();
            ok(false, 'Reader supposed to throw');
        } catch (ex) {
            ok(/Status 404/.test(ex.message), 'Reader throws ok');
        }
    });

    it('Destroy request on reader stop when keep alive', async () => {
        const request = httpClient({
            url: 'http://localhost:3004',
            agent: new http.Agent({
                keepAlive: true,
            }),
        }) as HttpClientRequest;
        request.end();
        const response = await request.response();
        await response.reader.stop();
    });
});
