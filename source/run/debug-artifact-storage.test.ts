import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { TestDebugArtifact } from '../packages/engine/engine.entry-point.ts';
import { debugArtifactFixture } from '../test-support/debug-artifact-fixture.ts';
import { runRecordPolicyFixture } from '../test-support/run-record-policy-fixture.ts';
import { createDebugArtifactStore } from './debug-artifact-storage.ts';
import { mergeDebugArtifacts } from './debug-artifact-results.ts';
import { executeRecordedRun } from './recorded-run.ts';

function assertStoredArtifact(
    scope: TestScope,
    saved: { readonly path: string; readonly content: string; } | undefined,
    directory: string,
    artifact: TestDebugArtifact
): void {
    scope.require.defined(saved);
    scope.assert.equal(path.dirname(saved.path), directory);
    scope.assert.equal(path.basename(saved.path).includes('outside'), false);
    const savedValue: unknown = JSON.parse(saved.content);
    scope.assert.equal(JSON.stringify(savedValue), JSON.stringify(artifact));
}

export const testNode = suite('debug artifact persistence', [
    test('storage uses identity-derived names and skips unchanged snapshots', async function (scope: TestScope) {
        const { artifact } = await debugArtifactFixture('../../outside');
        const writes: { readonly path: string; readonly content: string; }[] = [];
        const directory = '/state/runs/run/debug';
        const store = createDebugArtifactStore(directory, {
            async write(file, content) {
                writes.push({ path: file, content });
            }
        });
        scope.assert.deepEqual(await store.persist([ artifact ]), []);
        scope.assert.deepEqual(await store.persist([ artifact ]), []);
        scope.assert.equal(writes.length, 1);
        assertStoredArtifact(scope, writes[0], directory, artifact);
        return scope.assert.collect();
    }),
    test('placement attempts get separate files for the same work and retry', async function (scope: TestScope) {
        const { artifact } = await debugArtifactFixture('placement');
        const paths: string[] = [];
        const store = createDebugArtifactStore('/state/debug', {
            async write(file) {
                paths.push(file);
            }
        });
        await store.persist([ artifact, { ...artifact, id: { ...artifact.id, sequence: 1 } } ]);
        scope.assert.equal(paths.length, 2);
        const uniquePaths = new Set(paths);
        scope.assert.equal(uniquePaths.size, 2);
        return scope.assert.collect();
    }),
    test('family variants retain separate debug files and results', async function (scope: TestScope) {
        const { artifact } = await debugArtifactFixture('family');
        const paths: string[] = [];
        const store = createDebugArtifactStore('/state/debug', {
            async write(file) {
                paths.push(file);
            }
        });
        const first: TestDebugArtifact = {
            ...artifact,
            id: { ...artifact.id, familyVariant: { family: 'custom', key: 'first' } }
        };
        const second: TestDebugArtifact = {
            ...artifact,
            id: { ...artifact.id, familyVariant: { family: 'custom', key: 'second' } }
        };
        await store.persist([ first, second ]);
        const uniquePaths = new Set(paths);
        scope.assert.deepEqual([ paths.length, uniquePaths.size, mergeDebugArtifacts([ first, second ]).length ], [
            2,
            2,
            2
        ]);
        return scope.assert.collect();
    }),
    test('completed native evidence wins over a late checkpoint', async function (scope: TestScope) {
        const { artifact } = await debugArtifactFixture('complete');
        const checkpoint: TestDebugArtifact = {
            ...artifact,
            source: 'boundary-captured',
            payload: { ...artifact.payload, completeness: 'incomplete' }
        };
        scope.assert.deepEqual(mergeDebugArtifacts([ artifact, checkpoint ]), [ artifact ]);
        scope.assert.deepEqual(mergeDebugArtifacts([ checkpoint, artifact ]), [ artifact ]);
        scope.assert.equal(
            mergeDebugArtifacts([ artifact, { ...artifact, id: { ...artifact.id, sequence: 1 } } ]).length,
            2
        );
        return scope.assert.collect();
    }),
    test(
        'debug write failures fail the run while preserving the case verdict and run record',
        async function (scope: TestScope) {
            const { result } = await debugArtifactFixture('passing');
            const fixture = runRecordPolicyFixture('on-demand', true);
            const dependencies = {
                ...fixture.dependencies,
                runtimeStateStore: {
                    ...fixture.dependencies.runtimeStateStore,
                    async write(file: string, content: string) {
                        if (file.endsWith('.debug.json')) {
                            throw new Error('Runtime state is read-only.');
                        }
                        await fixture.dependencies.runtimeStateStore.write(file, content);
                    }
                }
            };
            const input = {
                ...fixture.input,
                request: {
                    ...fixture
                        .input
                        .request,
                    debug: { mode: 'all' as const, selectors: [] as const }
                }
            };
            const retained = await executeRecordedRun('/project', input, dependencies, async function execute() {
                return result;
            });
            scope.assert.equal(retained.status, 'failed');
            scope.assert.equal(retained.perTest[0]?.verdict, 'pass');
            scope.assert.equal(
                retained.runnerErrors.some(function artifactError(error) {
                    return error.subtype === 'artifact' && error.diagnostics.some(function file(detail) {
                        return detail.value.endsWith('.debug.json');
                    });
                }),
                true
            );
            scope.assert.equal(fixture.writes.at(-1)?.result?.status, 'failed');
            return scope.assert.collect();
        }
    )
]);
await runIfMain(import.meta, testNode);
