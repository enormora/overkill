import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { selectHistoryRemovals } from './history-retention-records.ts';

const now = '2026-10-30T00:00:00.000Z';
const metadata = [
    { version: 1, id: 'new-pass', status: 'passed', startedAt: now },
    { version: 1, id: 'old-pass', status: 'passed', startedAt: '2026-10-20T00:00:00.000Z' },
    { version: 1, id: 'boundary-fail', status: 'failed', startedAt: '2026-10-23T00:00:00.000Z' },
    { version: 1, id: 'expired-error', status: 'runner-error', startedAt: '2026-10-22T23:59:59.999Z' }
] as const;
const catalog = {
    records: metadata.map(function recordPath(value) {
        return `/state/runs/${value.id}.json`;
    }),
    artifactDirectories: metadata.map(function artifactPath(value) {
        return `/state/runs/${value.id}`;
    }),
    metadata: new Map(metadata.map(function retentionEntry(value) {
        return [ value.id, value ];
    }))
};
export const testNode = suite('record and artifact retention', [
    test('unclassified artifact directories cannot be selected for deletion', function (scope: TestScope) {
        scope.assert.throws(function () {
            return selectHistoryRemovals({ ...catalog, metadata: new Map() }, '/state/runs', defaultHistoryPolicy, now);
        }, { message: /Missing metadata/u });
        return scope.assert.collect();
    }),
    test('record count and artifact count and age policies apply independently', function (scope: TestScope) {
        const result = selectHistoryRemovals(catalog, '/state/runs', {
            ...defaultHistoryPolicy,
            detailedRunLimit: 1,
            successfulArtifactRunLimit: 1
        }, now);
        scope.assert.deepEqual(
            result.removedRecords.toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            }),
            [
                '/state/runs/boundary-fail.json',
                '/state/runs/expired-error.json',
                '/state/runs/old-pass.json'
            ]
        );
        scope.assert.deepEqual(
            result.removedArtifacts.toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            }),
            [
                '/state/runs/expired-error',
                '/state/runs/old-pass'
            ]
        );
        return scope.assert.collect();
    }),
    test(
        'zero limits remove successful records and artifacts but preserve recent failure evidence',
        function (scope: TestScope) {
            const result = selectHistoryRemovals(catalog, '/state/runs', {
                ...defaultHistoryPolicy,
                detailedRunLimit: 0,
                successfulArtifactRunLimit: 0
            }, now);
            scope.assert.equal(result.removedRecords.length, catalog.records.length);
            scope.assert.deepEqual(
                result.removedArtifacts.toSorted(function alphabetical(left, right) {
                    return left.localeCompare(right);
                }),
                [
                    '/state/runs/expired-error',
                    '/state/runs/new-pass',
                    '/state/runs/old-pass'
                ]
            );
            return scope.assert.collect();
        }
    )
]);
await runIfMain(import.meta, testNode);
