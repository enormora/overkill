import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { retentionCatalog, retentionCatalogScenario } from '../test-support/retention-catalog.ts';

export const testNode = authoredSuite('history retention catalog reconstruction', [
    authoredTest(
        'reconstructs committed record metadata and retains indexed artifact ownership',
        async function (scope: TestScope) {
            const fixture = await retentionCatalog(retentionCatalogScenario);
            const catalog = await fixture.read();
            scope.assert.deepEqual(catalog.records, [ '/project/state/runs/retained.json' ]);
            scope.assert.deepEqual(catalog.artifactDirectories, [ '/project/state/runs/retained' ]);
            scope.assert.deepEqual(Array.from(catalog.metadata.values()), [ {
                version: 1,
                detail: 'detailed',
                id: 'retained',
                startedAt: '2026-10-29T00:00:00.000Z',
                status: 'passed'
            } ]);
            return scope.assert.collect();
        }
    ),
    ...([ 'interrupted', 'merge', 'stale' ] as const).map(function (record) {
        return authoredTest(
            `retains ${record} records without requiring a current completion receipt`,
            async function (scope: TestScope) {
                const fixture = await retentionCatalog({ ...retentionCatalogScenario, record, indexed: false });
                const catalog = await fixture.read();
                scope.assert.equal(
                    catalog.metadata.get('retained')?.status,
                    record === 'interrupted' ? 'interrupted' : 'passed'
                );
                scope.assert.equal(catalog.records.length, 1);
                return scope.assert.collect();
            }
        );
    }),
    ...([ 'file', 'none' ] as const).map(function (artifact) {
        return authoredTest(`omits ${artifact} artifact entries`, async function (scope: TestScope) {
            const fixture = await retentionCatalog({ ...retentionCatalogScenario, artifact });
            const catalog = await fixture.read();
            scope.assert.deepEqual(catalog.artifactDirectories, []);
            scope.assert.equal(catalog.metadata.size, 1);
            return scope.assert.collect();
        });
    }),
    authoredTest('recovers orphan artifact ownership from its retained manifest', async function (scope: TestScope) {
        const fixture = await retentionCatalog({ ...retentionCatalogScenario, artifact: 'manifest', indexed: false });
        const catalog = await fixture.read();
        scope.assert.equal(catalog.metadata.get('orphan')?.status, 'passed');
        scope.assert.deepEqual(catalog.artifactDirectories, [ '/project/state/runs/orphan' ]);
        return scope.assert.collect();
    }),
    authoredTest('accepts an empty history catalog', async function (scope: TestScope) {
        const fixture = await retentionCatalog({
            ...retentionCatalogScenario,
            record: 'missing',
            artifact: 'none',
            indexed: false
        });
        const catalog = await fixture.read();
        scope.assert.deepEqual({
            records: catalog.records,
            artifacts: catalog.artifactDirectories,
            metadata: Array.from(catalog.metadata)
        }, { records: [], artifacts: [], metadata: [] });
        return scope.assert.collect();
    }),
    ...([ {
        record: 'mismatch',
        matcher: { message: 'Record identity does not match path: /project/state/runs/retained.json' }
    }, {
        record: 'uncommitted',
        matcher: {
            message: 'History state is unavailable. Run overkill history compact to repair it.',
            cause: { exact: 'Run retained has an incomplete history commit.' }
        }
    } ] as const)
        .map(function ({ record, matcher }) {
            return authoredTest(`rejects ${record} history records`, async function (scope: TestScope) {
                const fixture = await retentionCatalog({ ...retentionCatalogScenario, record });
                await scope.assert.rejects(fixture.read, matcher);
                return scope.assert.collect();
            });
        }),
    ...([ { artifact: 'mismatch', message: 'Artifact identity does not match path: /project/state/runs/retained' }, {
        artifact: 'unclassified',
        message: 'Missing artifact retention metadata: /project/state/runs/orphan'
    } ] as const)
        .map(function ({ artifact, message }) {
            return authoredTest(`rejects ${artifact} artifact ownership`, async function (scope: TestScope) {
                const fixture = await retentionCatalog({ ...retentionCatalogScenario, artifact });
                await scope.assert.rejects(fixture.read, { message });
                return scope.assert.collect();
            });
        })
]);
