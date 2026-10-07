import {setTimeout as wait} from 'node:timers/promises';
import { test, suite } from '../../../packages/test/test.entry-point.ts';
import { defineResource, withFailureArtifacts, withResources, createSimulatedHttpServerResource, createLocalProcessServiceResource } from '../../../packages/test/resources.entry-point.ts';
import { defineSimulatedHttpServer } from '../../../packages/simulation/simulation.entry-point.ts';

const owner = withFailureArtifacts(defineResource({
    name: 'shared-evidence', scope: 'per-run', requirements: [],
    acquire() { return { secret: 'owner-only' }; },
    dispose: null,
    serializeHandle() { return { public: true }; },
    deserializeHandle() { return { public: true }; }
}), async function prepareOwner(capture) {
    await capture.attachments.json({name: capture.kind, mediaType: 'application/json'}, {secret: capture.handle.secret});
});
const api = createSimulatedHttpServerResource({
    simulation: defineSimulatedHttpServer({
        name: 'api', scenarios: {default: {title: 'ready'}},
        handle() { return Response.json({ready: true}); }
    }),
    address: {kind: 'loopback', port: 0}
});
const daemon = createLocalProcessServiceResource({
    name: 'daemon', scope: 'per-case', requirements: [], dependencies: {},
    address: {kind: 'loopback', port: 0}, outputBufferBytes: 64,
    shutdown: {gracefulSignal: 'SIGTERM', forceSignal: 'SIGKILL', graceMilliseconds: 100},
    command() { return {command: process.execPath, arguments: ['-e', 'process.stdout.write("ready 🌍"); process.stderr.write("service warning"); setInterval(function keepAlive() {}, 1000);'], environment: {}, workingDirectory: null}; },
    async ready(owner) {
        while (!owner.output.stdout.text().includes('ready')) { await wait(5); }
        return {output: owner.output.stdout.text()};
    }
});
export const testNode = suite('failure evidence', [
    test('passing evidence is discarded', withResources({owner}, (scope) => {
        scope.assert.true(true);
        return scope.assert.collect();
    })),
    test('failed evidence preserves owner and simulation', withResources({owner, api, daemon}, async (scope) => {
        const response = await fetch(scope.resources.api.baseUrl);
        scope.assert.equal(response.status, 200);
        scope.assert.deepEqual(await response.json(), {ready: true});
        scope.assert.fail();
        return scope.assert.collect();
    }))
]);
