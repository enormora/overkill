import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    defineResource,
    withFailureArtifacts,
    withResources,
    type FailureArtifactAttachments
} from '../packages/test/resources.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { executeEvidence } from '../test-support/failure-evidence-fixture.ts';
import { currentAttachmentLimits } from '../packages/resources/attachment-context.entry-point.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const evidence = { name: 'diagnostic', mediaType: 'application/json' };
function throwCaptureFailure(cause: unknown): never {
    throw cause;
}
async function assertCombinedFailures(scope: TestScope): Promise<void> {
    const events: string[] = [];
    const base = defineResource({
        name: 'service',
        scope: 'shared-per-worker',
        requirements: [],
        acquire() {
            return { secret: 'owner' };
        },
        dispose() {
            events.push('dispose');
            throwCaptureFailure('disposal failed');
        }
    });
    const first = withFailureArtifacts(base, async function earlierCollector(capture) {
        if (capture.kind === 'lifetime') {
            events.push('first');
            await capture.attachments.json(evidence, { secret: capture.handle.secret });
            throwCaptureFailure(null);
        }
    });
    const resource = withFailureArtifacts(first, function laterCollector(capture) {
        if (capture.kind === 'lifetime') {
            events.push('second');
            throw new Error('collector failed');
        }
    });
    const fixture = await executeEvidence(
        scope,
        withResources({ resource }, function failingCase(testScope) {
            testScope.assert.equal(testScope.resources.resource.secret, 'owner');
            return testScope.assert.collect();
        }),
        3,
        defaultAttachmentLimits
    );
    scope.assert.deepEqual(events, [ 'first', 'second', 'dispose' ]);
    scope.assert.deepEqual(
        fixture.result.runnerErrors.map(function subtype(error) {
            return error.subtype;
        }),
        [ 'artifact', 'fixture' ]
    );
    scope.assert.equal(fixture.result.perTest[0]?.attempts.length, 1);
    scope.assert.equal(fixture.store.selectedArtifacts().length, 1);
}
async function assertCollectorOperationFailure(scope: TestScope): Promise<void> {
    let disposed = 0;
    const resource = withFailureArtifacts(
        defineResource({
            name: 'service',
            scope: 'per-case',
            requirements: [],
            acquire() {
                return {};
            },
            dispose() {
                disposed += 1;
            }
        }),
        async function invalidEvidence(capture) {
            await capture.attachments.json(evidence, undefined);
        }
    );
    const fixture = await executeEvidence(
        scope,
        withResources({ resource }, function originalFailure(testScope) {
            testScope.assert.equal('body failure', 'expected');
            return testScope.assert.collect();
        }),
        3,
        defaultAttachmentLimits
    );
    scope.assert.equal(disposed, 1);
    scope.assert.equal(fixture.result.perTest[0]?.attempts.length, 1);
    scope.assert.equal(fixture.result.perTest[0]?.attempts[0]?.outcome?.kind, 'fail');
    scope.assert.equal(fixture.result.runnerErrors[0]?.subtype, 'artifact');
}
async function assertDefaultScenario(scope: TestScope): Promise<void> {
    const resource = withFailureArtifacts(
        defineResource({
            name: 'service',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            scenarios: { mode: { default: 'ready', timing: 'acquire', values: [ 'ready', 'fault' ] } },
            acquire(context) {
                return { scenario: context.scenarios.mode };
            }
        }),
        async function selectedScenario(capture) {
            await capture.attachments.json(evidence, {
                scenario: capture.scenarios.mode,
                owner: capture.handle.scenario
            });
        }
    );
    const fixture = await executeEvidence(
        scope,
        withResources({ resource }, function failingCase(testScope) {
            testScope.assert.fail();
            return testScope.assert.collect();
        }),
        1,
        defaultAttachmentLimits
    );
    const artifact = fixture.store.selectedArtifacts()[0];
    scope.require.defined(artifact);
    scope.assert.partialDeepEqual(artifact.payload.content, {
        kind: 'json',
        value: { scenario: 'ready', owner: 'ready' }
    });
    scope.assert.deepEqual(fixture.result.runnerErrors, []);
}
async function assertExpiredWitness(scope: TestScope): Promise<void> {
    const captured = Promise.withResolvers<FailureArtifactAttachments>();
    const resource = withFailureArtifacts(
        defineResource({
            name: 'service',
            scope: 'per-case',
            requirements: [],
            acquire() {
                return {};
            },
            dispose: null
        }),
        function captureWitnessSink(capture) {
            if (capture.kind === 'attempt') {
                captured.resolve(capture.attachments);
            }
        }
    );
    const fixture = await executeEvidence(
        scope,
        withResources({ resource }, function passingCase(testScope) {
            testScope.assert.true(true);
            return testScope.assert.collect();
        }),
        1,
        defaultAttachmentLimits
    );
    const attachments = await captured.promise;
    scope.assert.equal(currentAttachmentLimits(), null);
    await scope.assert.rejects(async function escapedWitness() {
        await attachments.witness({
            producedBy: { library: 'service', libraryVersion: '1' },
            simulation: { name: 'service', payload: null },
            scenario: 'default',
            seed: null,
            runtimeSnapshot: null,
            faultConfiguration: null
        });
    }, { message: 'Simulation witnesses require runner-managed integration execution.' });
    scope.assert.deepEqual(fixture.store.artifacts(), []);
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/run/resource-failure-capture.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'witness sinks reject calls outside their integration run',
            async body(scope: TestScope) {
                await assertExpiredWitness(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'all lifetime collectors and disposal run after combined failures',
            async body(scope: TestScope) {
                await assertCombinedFailures(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'attachment operation failures preserve body verdicts and stop retries',
            async body(scope: TestScope) {
                await assertCollectorOperationFailure(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'direct resource collectors receive the selected default scenario',
            async body(scope: TestScope) {
                await assertDefaultScenario(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
