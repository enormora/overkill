import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, suite } from '../../../packages/test/test.entry-point.ts';
import { defineResource, withResource } from '../../../packages/test/resources.entry-point.ts';

const fixture = defineResource({
    async acquire({ attachments }) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-attachment-fixture-'));
        await attachments.json({ mediaType: 'application/json', name: 'fixture-setup' }, { phase: 'setup' });
        return { directory };
    },
    async dispose(handle, { attachments }) {
        await attachments.json({ mediaType: 'application/json', name: 'fixture-teardown' }, { phase: 'teardown' });
        await rm(handle.directory, { recursive: true, force: true });
    },
    name: 'fixture',
    requirements: [],
    scope: 'per-case'
});

export const testNode = suite('attachments', [
    test('preserves structured runtime evidence', withResource(fixture, async (scope) => {
        const log = await scope.attachments.open({ kind: 'text', mediaType: 'text/plain', name: 'service-log' });
        await log.write('starting\n');
        await log.write('ready 🌍\n');
        await log.close();
        await scope.attachments.json({ mediaType: 'application/json', name: 'accessibility' }, { violations: [], passes: [ 'contrast' ] });
        await scope.attachments.json({ mediaType: 'application/json', name: 'transcript' }, [ [ 'request', 'GET', '/users' ], [ 'response', 200 ] ]);
        const screenshot = await scope.attachments.open({ kind: 'binary', mediaType: 'image/png', name: 'screenshot' });
        await screenshot.write(new Uint8Array([ 137, 80, 78, 71 ]));
        const screenshotArtifact = await screenshot.close();
        const filePath = path.join(scope.resources.fixture.directory, 'service.log');
        await writeFile(filePath, 'retained after teardown');
        await scope.attachments.file({ mediaType: 'text/plain', name: 'service-file' }, filePath);
        scope.assert.equal(screenshotArtifact.payload.content.kind, 'file');
        return scope.assert.collect();
    }))
]);
