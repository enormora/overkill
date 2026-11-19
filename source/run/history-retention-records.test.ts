import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { propertyCorpusEntry } from '../test-support/property-corpus.ts';

import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { withReplay } from './replay-context.ts';
import { testNode as reconstruction } from './retention-catalog-policy.test.ts';
import { selectHistoryRemovals } from './history-retention-records.ts';

const now = '2026-10-30T00:00:00.000Z';
const metadata = [
    { version: 1, detail: 'detailed', id: 'new-pass', status: 'passed', startedAt: now },
    { version: 1, detail: 'detailed', id: 'old-pass', status: 'passed', startedAt: '2026-10-20T00:00:00.000Z' },
    { version: 1, detail: 'detailed', id: 'boundary-fail', status: 'failed', startedAt: '2026-10-23T00:00:00.000Z' },
    {
        version: 1,
        detail: 'detailed',
        id: 'expired-error',
        status: 'runner-error',
        startedAt: '2026-10-22T23:59:59.999Z'
    }
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
export const testNode = authoredSuite('record and artifact retention', [
    ...([ null, 'old-pass' ] as const).map(function (sourceRunId) {
        return authoredTest(
            `protects retained replay source ${String(sourceRunId)} during pruning`,
            async function (scope: TestScope) {
                await withReplay(
                    { kind: 'witness', witness: propertyCorpusEntry, sourceRunId, moduleGraph: 'current' },
                    null,
                    async function () {
                        const result = selectHistoryRemovals(catalog, '/state/runs', {
                            ...defaultHistoryPolicy,
                            detailedRunLimit: 0,
                            runSummaryRetentionDays: 1,
                            successfulArtifactRunLimit: 0
                        }, now);
                        scope.assert.deepEqual(
                            result
                                .removedRecords
                                .toSorted(function alphabetical(left, right) {
                                    return left.localeCompare(right);
                                }),
                            sourceRunId === null
                                ? [
                                    '/state/runs/boundary-fail.json',
                                    '/state/runs/expired-error.json',
                                    '/state/runs/old-pass.json'
                                ]
                                : [
                                    '/state/runs/boundary-fail.json',
                                    '/state/runs/expired-error.json'
                                ]
                        );
                        scope.assert.deepEqual(
                            result.removedArtifacts.toSorted(function alphabetical(left, right) {
                                return left.localeCompare(right);
                            }),
                            sourceRunId === null
                                ? [ '/state/runs/expired-error', '/state/runs/new-pass', '/state/runs/old-pass' ]
                                : [ '/state/runs/expired-error', '/state/runs/new-pass' ]
                        );
                    }
                );
                return scope.assert.collect();
            }
        );
    }),

    reconstruction,
    authoredTest('unclassified artifact directories cannot be selected for deletion', function (scope: TestScope) {
        scope.assert.throws(function () {
            return selectHistoryRemovals({ ...catalog, metadata: new Map() }, '/state/runs', defaultHistoryPolicy, now);
        }, { message: /Missing metadata/u });
        return scope.assert.collect();
    }),
    authoredTest('record count and artifact count and age policies apply independently', function (scope: TestScope) {
        const result = selectHistoryRemovals(catalog, '/state/runs', {
            ...defaultHistoryPolicy,
            detailedRunLimit: 1,
            successfulArtifactRunLimit: 1
        }, now);
        scope.assert.deepEqual(result.removedRecords, []);
        scope.assert.deepEqual(Array.from(result.detailedRecords), [ 'new-pass' ]);
        scope.assert.equal(result.retainedRecords.size, catalog.records.length);
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
    authoredTest(
        'zero detail limits retain compact records and preserve recent failure artifacts',
        function (scope: TestScope) {
            const result = selectHistoryRemovals(catalog, '/state/runs', {
                ...defaultHistoryPolicy,
                detailedRunLimit: 0,
                successfulArtifactRunLimit: 0
            }, now);
            scope.assert.equal(result.removedRecords.length, 0);
            scope.assert.equal(result.detailedRecords.size, 0);
            scope.assert.equal(result.retainedRecords.size, catalog.records.length);
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
