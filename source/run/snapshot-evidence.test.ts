import { suite, test } from '../packages/test/test.entry-point.ts';
import { evaluateSnapshot } from '../baselines/snapshot-context.ts';
import { baselineIdentityKey } from '../baselines/baseline-planning.ts';
import { attachmentWork } from '../test-support/attachment-fixture.ts';
import { recordSnapshotAttempt, storedSnapshot, snapshotWire as wire } from '../test-support/snapshot-fixture.ts';
import { ordinaryBaselineIdentity } from './baseline-record.ts';
import { snapshotEvidence } from './snapshot-evidence.ts';

export const testNode = suite('snapshot evidence planning', [
    test('keeps matching inline evidence and proposes changed payloads', async function (scope) {
        const captured = await recordSnapshotAttempt(scope, { ...wire, mode: 'update' }, async function capture() {
            await evaluateSnapshot({ kind: 'text', name: 'response', actual: 'hello' });
        });
        for (const previous of [ 'hello', 'previous' ]) {
            const baseline = storedSnapshot({ kind: 'text', name: 'response', actual: previous });
            const observed = await snapshotEvidence({
                artifacts: captured.artifacts,
                profile: wire.profile,
                work: attachmentWork,
                mode: 'update',
                existing: new Map([ [ baselineIdentityKey(ordinaryBaselineIdentity(baseline)), baseline ] ]),
                projectRoot: process.cwd()
            });
            scope.assert.equal(observed.changes.length, previous === 'hello' ? 0 : 1);
            scope.assert.equal(observed.identities.length, 1);
        }
        return scope.assert.collect();
    })
]);
