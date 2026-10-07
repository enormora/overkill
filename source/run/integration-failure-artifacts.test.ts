import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
    createSuite,
    createTestCase,
    type TestScope,
    type TestBody,
    type RunResult
} from '../packages/engine/engine.entry-point.ts';
import { defineResource, withFailureArtifacts, withResources } from '../packages/test/resources.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { attachmentFixtureForWork, type AttachmentFixture } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits, type AttachmentLimits } from '../engine/runtime-attachment.ts';
import { createResourceLifecycleRuntimePolicy } from './resource-lifecycle.ts';
import { runWithAttachmentExecution } from './resource-lifecycle-state.ts';
import { resultWithRuntimeAttachments } from './attachment-results.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const evidence = { name: 'evidence', mediaType: 'application/json' };

async function executeEvidence(
    scope: TestScope,
    body: TestBody,
    attempts: number,
    limits: AttachmentLimits
): Promise<AttachmentFixture & { readonly result: RunResult; }> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        ...metadata,
        title: 'root',
        children: [ engine.createTestCase({ ...metadata, title: 'case', body }) ]
    }));
    const fixture = await attachmentFixtureForWork(
        scope,
        limits,
        plan.cases.map(function work(entry) {
            return entry.workId;
        })
    );
    const result = await runWithAttachmentExecution(fixture.execution, async function executeManagedResources() {
        return await engine.execute(plan, {
            execution: { mode: 'serial-in-process' },
            reporters: [],
            runFacts: {},
            startedAt: '1970-01-01T00:00:00.000Z',
            retryPolicy: { maxAttempts: attempts },
            runtimePolicy: createResourceLifecycleRuntimePolicy(plan.cases, null)
        });
    });
    fixture.store.settleResult(result);
    return { ...fixture, result };
}

const diagnostic = withFailureArtifacts(
    defineResource({
        name: 'diagnostic',
        scope: 'per-case',
        requirements: [],
        acquire() {
            return { ready: true };
        },
        dispose: null
    }),
    async function prepareDiagnostic(capture) {
        if (capture.kind === 'attempt') {
            await capture.attachments.json(evidence, {
                ready: capture.handle.ready,
                attempt: capture.attempt.index
            });
        }
    }
);
async function assertPreparedFile(scope: TestScope, fixture: AttachmentFixture): Promise<void> {
    const artifact = fixture.store.selectedArtifacts()[0];
    if (artifact?.payload.content.kind !== 'file') {
        throw new TypeError('Expected retained evidence file.');
    }
    scope.assert.equal(await readFile(artifact.payload.content.path, 'utf8'), 'before cleanup');
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/run/integration-failure-artifacts.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'oversized seedless witnesses become bounded omissions',
            async body(scope: TestScope) {
                const resource = withFailureArtifacts(diagnostic, async function witness(capture) {
                    if (capture.kind === 'attempt') {
                        await capture.attachments.witness({
                            producedBy: { library: 'diagnostic', libraryVersion: '1' },
                            simulation: { name: 'diagnostic', payload: { version: 1, value: 'x'.repeat(100) } },
                            scenario: 'default',
                            seed: null,
                            runtimeSnapshot: null,
                            faultConfiguration: null
                        });
                    }
                });
                const fixture = await executeEvidence(
                    scope,
                    withResources({ resource }, function (testScope) {
                        testScope.assert.fail();
                        return testScope.assert.collect();
                    }),
                    1,
                    { ...defaultAttachmentLimits, maxArtifactBytes: 32 }
                );
                const witness = fixture.store.selectedArtifacts().find(function nativeWitness(artifact) {
                    return artifact.id.subtype === 'witness';
                });
                scope.assert.deepEqual(fixture.result.runnerErrors, []);
                scope.require.defined(witness);
                scope.assert.deepEqual(witness.payload.content, { kind: 'omitted', reason: 'byte-limit', limit: 32 });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'failed shared lifetime collectors still dispose owner handles',
            async body(scope: TestScope) {
                let disposed = 0;
                const resource = withFailureArtifacts(
                    defineResource({
                        name: 'shared',
                        scope: 'per-run',
                        requirements: [],
                        acquire() {
                            return { secret: 'owner' };
                        },
                        dispose() {
                            disposed += 1;
                        },
                        serializeHandle() {
                            return { public: true };
                        },
                        deserializeHandle() {
                            return { public: true };
                        }
                    }),
                    function lifetimeFails(capture) {
                        if (capture.kind === 'lifetime') {
                            throw new Error('lifetime collection failed');
                        }
                    }
                );
                const fixture = await executeEvidence(
                    scope,
                    withResources({ resource }, function (testScope) {
                        testScope.assert.true(true);
                        return testScope.assert.collect();
                    }),
                    1,
                    defaultAttachmentLimits
                );
                scope.assert.equal(disposed, 1);
                scope.assert.equal(fixture.result.runnerErrors[0]?.subtype, 'artifact');
                scope.assert.equal(fixture.result.status, 'failed');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'passing attempts discard prepared evidence and retain explicit attachments',
            async body(scope) {
                const resource = diagnostic;
                const fixture = await executeEvidence(
                    scope,
                    withResources({ resource }, async function passingCase(testScope) {
                        await testScope.attachments.json({ ...evidence, name: 'explicit' }, { kept: true });
                        testScope.assert.true(testScope.resources.resource.ready);
                        return testScope.assert.collect();
                    }),
                    1,
                    defaultAttachmentLimits
                );
                scope.assert.equal(fixture.result.status, 'passed');
                scope.assert.equal(fixture.store.artifacts().length, 2);
                scope.assert.deepEqual(
                    fixture.store.selectedArtifacts().map(function name(artifact) {
                        return artifact.payload.name;
                    }),
                    [ 'explicit' ]
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'scope cleanup failures preserve files prepared before deletion',
            async body(scope) {
                const directory = await mkdtemp('target/failure-evidence-');
                scope.cleanup(async function removeEvidenceDirectory() {
                    await rm(directory, { recursive: true, force: true });
                });
                const file = `${directory}/service.log`;
                const resource = withFailureArtifacts(
                    defineResource({
                        name: 'service',
                        scope: 'per-case',
                        requirements: [],
                        async acquire() {
                            await writeFile(file, 'before cleanup');
                            return { file };
                        },
                        dispose: null
                    }),
                    async function prepareFile(capture) {
                        await capture.attachments.file(
                            { name: 'service-log', mediaType: 'text/plain' },
                            capture.handle.file
                        );
                    }
                );
                const fixture = await executeEvidence(
                    scope,
                    withResources({ resource }, function cleanupFails(testScope) {
                        testScope.cleanup(async function deleteThenFail() {
                            await rm(file);
                            throw new Error('cleanup failed');
                        });
                        testScope.assert.true(true);
                        return testScope.assert.collect();
                    }),
                    1,
                    defaultAttachmentLimits
                );
                scope.assert.equal(fixture.result.status, 'failed');
                await assertPreparedFile(scope, fixture);
                await scope.assert.rejects(async function originalRemoved() {
                    await readFile(file);
                }, { code: 'ENOENT' });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'retry retention keeps first failure and final evidence without mixing attempts',
            async body(scope) {
                const resource = diagnostic;
                const fixture = await executeEvidence(
                    scope,
                    withResources({ resource }, function failingCase(testScope) {
                        testScope.assert.fail();
                        return testScope.assert.collect();
                    }),
                    3,
                    defaultAttachmentLimits
                );
                const result = resultWithRuntimeAttachments(fixture.result, fixture.store.selectedArtifacts(), {
                    localErrors: [],
                    owners: [],
                    policy: 'first-failure-and-final',
                    retainsBranch() {
                        return true;
                    }
                });
                scope.assert.deepEqual(
                    result.artifacts.map(function attempt(artifact) {
                        return artifact.id.attempt?.index;
                    }),
                    [ 0, 2 ]
                );
                scope.assert.equal(fixture.result.perTest[0]?.attempts.length, 3);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'collector errors remain artifact errors and prevent retry while cleanup runs',
            async body(scope) {
                let disposed = 0;
                const resource = withFailureArtifacts(
                    defineResource({
                        name: 'broken',
                        scope: 'per-case',
                        requirements: [],
                        acquire() {
                            return {};
                        },
                        dispose() {
                            disposed += 1;
                        }
                    }),
                    function rejectCollection() {
                        throw new Error('collector failed');
                    }
                );
                const fixture = await executeEvidence(
                    scope,
                    withResources({ resource }, function passingCase(testScope) {
                        testScope.assert.true(true);
                        return testScope.assert.collect();
                    }),
                    3,
                    defaultAttachmentLimits
                );
                scope.assert.equal(disposed, 1);
                scope.assert.equal(fixture.result.perTest[0]?.attempts.length, 1);
                scope.assert.equal(fixture.result.runnerErrors[0]?.subtype, 'artifact');
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
