import { setTimeout as wait } from 'node:timers/promises';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createLocalProcessServiceResource, withResources } from '../packages/test/resources.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { executeEvidence } from '../test-support/failure-evidence-fixture.ts';
import type { AttachmentFixture } from '../test-support/attachment-fixture.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
function assertProcessOutput(scope: TestScope, fixture: AttachmentFixture, name: string, expected: string): void {
    const artifact = fixture.store.selectedArtifacts().find(function matchingOutput(entry) {
        return entry.payload.name === name;
    });
    scope.require.defined(artifact);
    if (artifact.payload.content.kind !== 'text') {
        throw new Error('Expected process evidence.');
    }
    scope.assert.equal(artifact.payload.content.text, expected);
}
async function assertProcessBoundary(scope: TestScope, readinessFails: boolean): Promise<void> {
    const resource = createLocalProcessServiceResource({
        name: 'daemon',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        outputBufferBytes: 64,
        shutdown: { gracefulSignal: 'SIGTERM', forceSignal: 'SIGKILL', graceMilliseconds: 10 },
        command() {
            return {
                command: process.execPath,
                arguments: [
                    '-e',
                    'process.on("SIGTERM", () => {}); process.stdout.write(Buffer.from([114,101,97,100,121,240])); process.stderr.write(Buffer.from([119,97,114,110,105,110,103,195])); setInterval(() => {}, 1000);'
                ],
                environment: {},
                workingDirectory: null
            };
        },
        async ready(owner) {
            while (!owner.output.stdout.text().includes('ready')) {
                await wait(5);
            }
            if (readinessFails) {
                throw new Error('Readiness failed.');
            }
            return { ready: true };
        }
    });
    const fixture = await executeEvidence(
        scope,
        withResources({ resource }, function failingBody(testScope) {
            testScope.assert.fail();
            return testScope.assert.collect();
        }),
        1,
        defaultAttachmentLimits
    );
    assertProcessOutput(scope, fixture, 'stdout', 'ready�');
    assertProcessOutput(scope, fixture, 'stderr', 'warning�');
    scope.assert.equal(fixture.result.status, 'failed');
    scope.assert.equal(fixture.result.runnerErrors.length, readinessFails ? 1 : 0);
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/run/process-failure-evidence.test.ts',
    children: [ false, true ].map(function processBoundary(readinessFails) {
        return createTestCase({
            ...metadata,
            title: `process evidence survives forced shutdown and readiness failure: ${readinessFails}`,
            async body(scope: TestScope) {
                await assertProcessBoundary(scope, readinessFails);
                return scope.assert.collect();
            }
        });
    })
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
