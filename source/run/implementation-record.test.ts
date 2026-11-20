import { type TestNode, suite, test } from '@overkill-dev/test';

import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';

import { workerReplayRecord } from '../test-support/replay-record-fixture.ts';
import { implementationFingerprint } from '../implementation-fingerprint.ts';
import { createCollectedPlan, fakeWorkerRuntime } from '../test-support/worker-pool-execution-state.ts';
import type { ReplayRunRecord } from './replay-record-types.ts';
import { mergeCompatibilityConflicts } from './merge-results-compatibility.ts';
import { replayRecordSchema } from './replay-record-schema.ts';
import { currentRunRecordVersion } from './run-record-format.ts';

function record(): ReplayRunRecord {
    return workerReplayRecord(fakeWorkerRuntime(createCollectedPlan()), null);
}
function implementationEvidence(): NonNullable<ReplayRunRecord['facts']['implementations']> {
    const identity = {
        modules: [],
        builtins: [],
        entries: {},
        runtime: {
            node: process.version,
            platform: process.platform,
            architecture: process.arch,
            typescript: process.features.typescript
        }
    };
    return {
        projectRoot: '/project',
        builds: [ { assignments: [], graph: { ...identity, build: implementationFingerprint(identity) } } ]
    };
}
export const testNode: TestNode = suite('recorded implementation provenance', [
    test('reports incompatible implementation catalogs as merge conflicts', function (scope) {
        const current = mergeRecordFixture('current', 1, 1);
        const implementations = implementationEvidence();
        const conflicts = mergeCompatibilityConflicts([ {
            path: 'current',
            record: { ...current, facts: { ...current.facts, implementations } }
        }, {
            path: 'other',
            record: {
                ...current,
                facts: { ...current.facts, implementations: { ...implementations, projectRoot: '/other' } }
            }
        } ]);
        scope.assert.deepEqual(conflicts, [ {
            field: 'implementations',
            reason: 'mismatch',
            referencePath: 'current',
            sourcePath: 'other'
        } ]);
        return scope.assert.collect();
    }),
    test('rejects superseded run-record versions', function (scope) {
        const current = record();
        for (const version of [ 2, 3, 4, 5 ]) {
            scope.assert.false(replayRecordSchema.safeParse({ ...current, version }).success);
        }
        return scope.assert.collect();
    }),
    test(
        'requires explicit implementation evidence on both sides of a current replay snapshot',
        function (scope) {
            const current = record();
            scope.assert.equal(current.version, currentRunRecordVersion);
            for (const field of [ 'facts', 'replayPlan' ] as const) {
                const incomplete = structuredClone(current);
                Reflect.deleteProperty(incomplete[field], 'implementations');
                scope.assert.equal(replayRecordSchema.safeParse(incomplete).success, false);
            }
            return scope.assert.collect();
        }
    ),
    test('rejects a replay plan whose implementation provenance differs from its facts', function (scope) {
        const current = record();
        const identity = {
            modules: [],
            builtins: [],
            entries: {},
            runtime: {
                node: process.version,
                platform: process.platform,
                architecture: process.arch,
                typescript: process.features.typescript
            }
        };
        const implementations = {
            projectRoot: '/project',
            builds: [ { assignments: [], graph: { ...identity, build: implementationFingerprint(identity) } } ]
        };
        const parsed = replayRecordSchema.safeParse({ ...current, facts: { ...current.facts, implementations } });
        scope.assert.equal(parsed.success, false);
        if (parsed.success) {
            throw new Error('Expected inconsistent provenance to be rejected.');
        }
        scope.assert.equal(
            parsed.error.issues.some(function inconsistent(issue) {
                return issue.message === 'Recorded implementation provenance is inconsistent.';
            }),
            true
        );
        return scope.assert.collect();
    })
]);
