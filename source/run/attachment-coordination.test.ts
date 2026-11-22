import { suite, test } from '@overkill-dev/test';

import {
    attachmentCoordination,
    attachmentCoordinationResult,
    captureCoordinatedAttachment
} from '../test-support/attachment-coordination.ts';
import { attachmentWork, attachmentPeerWork } from '../test-support/attachment-fixture.ts';

export const testNode = suite('run attachment coordination', [
    test('retains case evidence and filters it by attempt and work identity', async function (scope) {
        const { coordinator } = attachmentCoordination(null);
        const artifact = await captureCoordinatedAttachment(coordinator, attachmentWork, { index: 0 }, null);
        scope.assert.deepEqual(coordinator.caseArtifacts(attachmentWork, { index: 0 }, null), [ artifact ]);
        scope.assert.deepEqual(coordinator.caseArtifacts(attachmentPeerWork, { index: 0 }, null), []);
        scope.assert.deepEqual(coordinator.caseArtifacts(attachmentWork, { index: 1 }, null), []);
        await coordinator.close();
        return scope.assert.collect();
    }),
    test(
        'assigns stable branch endpoints without sharing identities between branches',
        async function (scope) {
            const { coordinator } = attachmentCoordination(null);
            const branch = {};
            const endpoint = coordinator.branchEndpoint(branch, function () {
                return true;
            });
            scope.assert.deepEqual(
                coordinator.branchEndpoint(branch, function () {
                    return true;
                }),
                endpoint
            );
            scope.assert.notEqual(
                coordinator
                    .branchEndpoint({}, function () {
                        return true;
                    })
                    .branch,
                endpoint.branch
            );
            scope.assert.deepEqual(coordinator.branchArtifacts({}), []);
            await coordinator.close();
            return scope.assert.collect();
        }
    ),
    test('retains branch evidence according to its settlement authority', async function (scope) {
        const { coordinator } = attachmentCoordination(null);
        const branch = {};
        const endpoint = coordinator.branchEndpoint(branch, function () {
            return true;
        });
        const artifact = await captureCoordinatedAttachment(coordinator, attachmentWork, { index: 0 }, endpoint.branch);
        coordinator.settleAttempt(attachmentWork, { index: 0 }, 'pass', branch);
        scope.assert.deepEqual(coordinator.caseArtifacts(attachmentWork, { index: 0 }, branch), [ artifact ]);
        const result = await coordinator.finalize(attachmentCoordinationResult);
        scope.assert.equal(result.artifacts.length, 1);
        return scope.assert.collect();
    }),
    test('finalizes and prunes evidence once while preserving existing results', async function (scope) {
        const fixture = attachmentCoordination(null);
        const artifact = await captureCoordinatedAttachment(fixture.coordinator, attachmentWork, { index: 0 }, null);
        fixture.coordinator.settleAttempt(attachmentWork, { index: 0 }, 'pass', null);
        const result = await fixture.coordinator.finalize(attachmentCoordinationResult);
        scope.assert.deepEqual(result.artifacts, [ artifact ]);
        scope.assert.equal(await fixture.coordinator.finalize(result), result);
        scope.assert.deepEqual(fixture.calls, [ 'finish', 'prune' ]);
        scope.assert.equal(result.status, 'passed');
        return scope.assert.collect();
    }),
    test('preserves server shutdown failures during finalization', async function (scope) {
        const fixture = attachmentCoordination(new Error('Shutdown failed.'));
        await scope.assert.rejects(async function () {
            await fixture.coordinator.finalize(attachmentCoordinationResult);
        }, { message: 'Shutdown failed.' });
        scope.assert.deepEqual(fixture.calls, [ 'finish' ]);
        return scope.assert.collect();
    })
]);
