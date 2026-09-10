import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { TestScope } from '../../../packages/engine/engine.entry-point.ts';
import { createTemporaryDirectoryResource } from '../../../packages/test/resources.entry-point.ts';
import { createTestFacade } from '../../../packages/test/test.entry-point.ts';

const integration = createTestFacade({
    annotations: {},
    controls: {},
    testFamily: 'integration'
});

const outputPath = 'source/integration-tests/run/fixtures/integration-unrestricted-runtime-output.txt';
const resourceSignal = new AbortController().signal;
const temporaryDirectoryResource = createTemporaryDirectoryResource('scratch');

function listen(server: Server): Promise<number> {
    return new Promise(function resolvePort(resolve, reject) {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', function resolveListeningServer() {
            server.off('error', reject);

            const address = server.address() as AddressInfo;

            resolve(address.port);
        });
    });
}

function close(server: Server): Promise<void> {
    return new Promise(function resolveClose(resolve, reject) {
        server.close(function resolveClosedServer(error) {
            if (error === undefined) {
                resolve();

                return;
            }

            reject(error);
        });
    });
}

async function exerciseTemporaryDirectoryResource(scope: TestScope): Promise<void> {
    const temporaryDirectory = await temporaryDirectoryResource.acquire({ resources: {}, signal: resourceSignal });

    if (temporaryDirectoryResource.dispose === null) {
        throw new Error('Expected temporary directory disposal.');
    }

    try {
        await writeFile(join(temporaryDirectory.path, 'artifact.txt'), 'temporary');
        scope.assert.equal(temporaryDirectory.path.includes('overkill-temporary-directory-'), true);
    } finally {
        await temporaryDirectoryResource.dispose(temporaryDirectory, { resources: {}, signal: resourceSignal });
    }
}

export const testNode = integration.test('uses unrestricted runtime effects', async function useRuntime(scope) {
    await writeFile(outputPath, 'integration');
    await exerciseTemporaryDirectoryResource(scope);

    const child = spawnSync(process.execPath, [ '-e', 'process.stdout.write("child")' ], {
        encoding: 'utf8'
    });

    scope.assert.equal(child.status, 0);
    scope.assert.equal(child.stdout, 'child');

    const server = createServer(function respond(_request, response) {
        response.end('loopback');
    });

    try {
        const port = await listen(server);
        const response = await fetch(`http://127.0.0.1:${port}`);

        scope.assert.equal(await response.text(), 'loopback');
    } finally {
        await close(server);
    }

    return scope.assert.collect();
});
