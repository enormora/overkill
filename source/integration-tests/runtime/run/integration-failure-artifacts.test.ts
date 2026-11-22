import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

import { defineMacro, suite, test, type TestScope } from '@overkill-dev/test';

import {
    defineResource,
    withFailureArtifacts,
    withResources,
    createSimulatedHttpServerResource,
    createLocalProcessServiceResource
} from '../../../packages/test/resources.entry-point.ts';
import { defineSimulatedHttpServer } from '../../../packages/simulation/simulation.entry-point.ts';
import {
    executeEvidence,
    assertPreparedFile,
    assertNativeEvidence,
    assertCapturedText,
    assertSeededWitness
} from '../../../test-support/failure-evidence-fixture.ts';
import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { resultWithRuntimeAttachments } from '../../../run/attachment-results.ts';

const evidence = { name: 'evidence', mediaType: 'application/json' };

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
const daemon = createLocalProcessServiceResource({
    name: 'daemon',
    scope: 'per-case',
    requirements: [],
    dependencies: {},
    address: { kind: 'loopback', port: 0 },
    outputBufferBytes: 64,
    shutdown: { gracefulSignal: 'SIGTERM', forceSignal: 'SIGKILL', graceMilliseconds: 100 },
    command() {
        return {
            command: process.execPath,
            arguments: [
                '-e',
                'process.stdout.write("ready 🌍"); process.stderr.write("warning"); setInterval(() => {}, 1000);'
            ],
            environment: {},
            workingDirectory: null
        };
    },
    async ready(owner) {
        while (!owner.output.stdout.text().includes('ready') || !owner.output.stderr.text().includes('warning')) {
            await wait(5);
        }
        return { output: owner.output.stdout.text() };
    }
});
const assertFirstPartyEvidence = defineMacro(function (title: string) {
    return test(title, async function (scope) {
        const api = createSimulatedHttpServerResource({
            address: { kind: 'loopback', port: 0 },
            simulation: defineSimulatedHttpServer({
                name: 'api',
                scenarios: { default: { title: 'ready' } },
                handle() {
                    return Response.json({ ready: true });
                }
            })
        });
        const fixture = await executeEvidence(
            scope.cleanup,
            withResources({ api, daemon }, async function failingHttpCase(testScope) {
                const response = await fetch(testScope.resources.api.baseUrl);
                await response.json();
                testScope.assert.fail();
                return testScope.assert.collect();
            }),
            1,
            defaultAttachmentLimits
        );
        const artifacts = fixture.store.selectedArtifacts();
        scope.assert.deepEqual(fixture.result.runnerErrors, []);
        scope.assert.equal(artifacts.length, 4);
        scope.assert(assertCapturedText, fixture, 'stdout', 'ready 🌍');
        scope.assert(assertCapturedText, fixture, 'stderr', 'warning');
        await scope.assert(assertNativeEvidence, fixture);

        return scope.assert.collect();
    });
});
export const testNode = suite('Integration failure artifacts', [
    assertFirstPartyEvidence('failed managed services retain HTTP evidence, decoded output, and native witnesses'),
    test('native witnesses preserve decimal simulation seeds and runtime state', async function (scope) {
        const resource = withFailureArtifacts(diagnostic, async function seededWitness(capture) {
            if (capture.kind === 'attempt') {
                await capture.attachments.witness({
                    producedBy: { library: 'diagnostic', libraryVersion: '1' },
                    simulation: { name: 'diagnostic', payload: { version: 1 } },
                    scenario: 'fault',
                    seed: 9_007_199_254_740_993n,
                    runtimeSnapshot: { phase: 'request' },
                    faultConfiguration: { delay: 5 }
                });
            }
        });
        const fixture = await executeEvidence(
            scope.cleanup,
            withResources({ resource }, function fail(testScope) {
                testScope.assert.fail();
                return testScope.assert.collect();
            }),
            1,
            defaultAttachmentLimits
        );
        await scope.assert(assertSeededWitness, fixture);
        return scope.assert.collect();
    }),
    test('oversized seedless witnesses become bounded omissions', async function (scope: TestScope) {
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
            scope.cleanup,
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
    }),
    test('failed shared lifetime collectors still dispose owner handles', async function (scope) {
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
            scope.cleanup,
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
    }),
    test(
        'passing attempts discard prepared evidence and retain explicit attachments',
        async function (scope) {
            const resource = diagnostic;
            const fixture = await executeEvidence(
                scope.cleanup,
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
    ),
    test('scope cleanup failures preserve files prepared before deletion', async function (scope) {
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
            scope.cleanup,
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
        await scope.assert(assertPreparedFile, fixture);
        await scope.assert.rejects(async function originalRemoved() {
            await readFile(file);
        }, { code: 'ENOENT' });
        return scope.assert.collect();
    }),
    test(
        'retry retention keeps first failure and final evidence without mixing attempts',
        async function (scope) {
            const resource = diagnostic;
            const fixture = await executeEvidence(
                scope.cleanup,
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
    ),
    test(
        'collector errors remain artifact errors and prevent retry while cleanup runs',
        async function (scope) {
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
                scope.cleanup,
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
    )
]);
