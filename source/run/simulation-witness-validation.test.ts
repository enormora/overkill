import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineResource, withFailureArtifacts, withResources } from '../packages/test/resources.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { executeEvidence } from '../test-support/failure-evidence-fixture.ts';

export const testNode = suite('simulation witness validation', [
    test('invalid envelopes retain the body failure and permit disposal', async function (scope) {
        const disposed: string[] = [];
        const resource = withFailureArtifacts(
            defineResource({
                name: 'invalid-witness',
                scope: 'per-case',
                requirements: [],
                acquire() {
                    return 'owner';
                },
                dispose(handle) {
                    disposed.push(handle);
                }
            }),
            async function prepare(capture) {
                if (capture.kind === 'attempt') {
                    const input = {
                        producedBy: { library: 'simulator', libraryVersion: '1' },
                        simulation: { name: 'backend', payload: {} },
                        scenario: 'default',
                        seed: null,
                        runtimeSnapshot: null,
                        faultConfiguration: null,
                        unexpected: true
                    };
                    await capture.attachments.witness(input);
                }
            }
        );
        const fixture = await executeEvidence(
            scope,
            withResources({ resource }, function fail(testScope) {
                testScope.assert.fail();
                return testScope.assert.collect();
            }),
            1,
            defaultAttachmentLimits
        );
        scope.assert.equal(fixture.result.perTest[0]?.attempts[0]?.outcome?.kind, 'fail');
        scope.assert.true(fixture.result.runnerErrors.some(function artifactError(error) {
            return error.subtype === 'artifact';
        }));
        scope.assert.deepEqual(disposed, [ 'owner' ]);
        scope.assert.false(
            fixture.store.selectedArtifacts().some(function witness(artifact) {
                return artifact.id.subtype === 'witness';
            })
        );
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
