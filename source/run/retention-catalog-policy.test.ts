import { table, suite, test } from '@overkill-dev/test';

import { retentionCatalog, retentionCatalogScenario } from '../test-support/retention-catalog.ts';

export const testNode = suite('history retention catalog reconstruction', [
    test(
        'reconstructs committed record metadata and retains indexed artifact ownership',
        async function (scope) {
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
    table({
        title: 'retains records without a current completion receipt',
        cases: [ 'interrupted', 'merge', 'stale' ] as const,
        caseTitle(record) {
            return record;
        },
        async test(scope) {
            const record = scope.parameters;

            const fixture = await retentionCatalog({ ...retentionCatalogScenario, record, indexed: false });
            const catalog = await fixture.read();
            scope.assert.equal(
                catalog.metadata.get('retained')?.status,
                record === 'interrupted' ? 'interrupted' : 'passed'
            );
            scope.assert.equal(catalog.records.length, 1);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'omits invalid artifact entries',
        cases: [ 'file', 'none' ] as const,
        caseTitle(artifact) {
            return artifact;
        },
        async test(scope) {
            const artifact = scope.parameters;

            const fixture = await retentionCatalog({ ...retentionCatalogScenario, artifact });
            const catalog = await fixture.read();
            scope.assert.deepEqual(catalog.artifactDirectories, []);
            scope.assert.equal(catalog.metadata.size, 1);
            return scope.assert.collect();
        }
    }),
    test('recovers orphan artifact ownership from its retained manifest', async function (scope) {
        const fixture = await retentionCatalog({ ...retentionCatalogScenario, artifact: 'manifest', indexed: false });
        const catalog = await fixture.read();
        scope.assert.equal(catalog.metadata.get('orphan')?.status, 'passed');
        scope.assert.deepEqual(catalog.artifactDirectories, [ '/project/state/runs/orphan' ]);
        return scope.assert.collect();
    }),
    test('accepts an empty history catalog', async function (scope) {
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
    table({
        title: 'rejects invalid history records',
        cases: [ {
            record: 'mismatch',
            matcher: { message: 'Record identity does not match path: /project/state/runs/retained.json' }
        }, {
            record: 'uncommitted',
            matcher: {
                message: 'History state is unavailable. Run overkill history compact to repair it.',
                cause: { exact: 'Run retained has an incomplete history commit.' }
            }
        } ] as const,
        caseTitle({ record }) {
            return record;
        },
        async test(scope) {
            const { record, matcher } = scope.parameters;

            const fixture = await retentionCatalog({ ...retentionCatalogScenario, record });
            await scope.assert.rejects(fixture.read, matcher);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid artifact ownership',
        cases: [ {
            artifact: 'mismatch',
            message: 'Artifact identity does not match path: /project/state/runs/retained'
        }, {
            artifact: 'unclassified',
            message: 'Missing artifact retention metadata: /project/state/runs/orphan'
        } ] as const,
        caseTitle({ artifact }) {
            return artifact;
        },
        async test(scope) {
            const { artifact, message } = scope.parameters;

            const fixture = await retentionCatalog({ ...retentionCatalogScenario, artifact });
            await scope.assert.rejects(fixture.read, { message });
            return scope.assert.collect();
        }
    })
]);
