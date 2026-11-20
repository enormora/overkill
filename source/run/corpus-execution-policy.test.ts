import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { corpusExecution, corpusDiagnostics } from '../test-support/corpus-execution.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { confirmedWitnessResult } from '../test-support/witness-attachment-retention.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { emptyPropertyCorpus } from '../engine/property-corpus.ts';
import { withReplay } from './replay-context.ts';

export const testNode: TestNode = suite('corpus execution storage policy', [
    test('loads configured corpus snapshots only for property profiles', async function (scope) {
        const fixture = await corpusExecution('pass', true);
        scope.assert.deepEqual(await fixture.execution.resolve(fixture.run), {
            checkedIn: [ propertyCorpusEntry ],
            localCache: [],
            diagnostics: []
        });
        scope.assert.equal(fixture.events.length, 1);
        return scope.assert.collect();
    }),
    test('skips corpus access for other families', async function (scope) {
        const fixture = await corpusExecution('pass', false);
        const result = runResultFactory.build();
        scope.assert.equal(await fixture.execution.resolve(fixture.run), emptyPropertyCorpus);
        scope.assert.equal(await fixture.execution.persist(fixture.run, result), result);
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('skips reading and writing corpus during selected witness replay', async function (scope) {
        const fixture = await corpusExecution('pass', true);
        const result = confirmedWitnessResult(true);
        await withReplay(
            { kind: 'witness', witness: propertyCorpusEntry, sourceRunId: null, moduleGraph: 'current' },
            null,
            async function () {
                scope.assert.equal(await fixture.execution.resolve(fixture.run), emptyPropertyCorpus);
                scope.assert.equal(await fixture.execution.persist(fixture.run, result), result);
            }
        );
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('honors witness context frozen into run facts', async function (scope) {
        const fixture = await corpusExecution('pass', true);
        scope.assert.equal(
            await fixture.execution.resolve({
                ...fixture.run,
                facts: {
                    ...fixture
                        .run
                        .facts,
                    propertyReplay: propertyCorpusEntry
                }
            }),
            emptyPropertyCorpus
        );
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    table({
        title: 'persists only confirmed witnesses',
        cases: [ false, true ],
        caseTitle: String,
        async test(scope) {
            const confirmed = scope.parameters;

            const fixture = await corpusExecution('pass', true);
            const result = confirmedWitnessResult(confirmed);
            scope.assert.equal(await fixture.execution.persist(fixture.run, result), result);
            scope.assert.deepEqual(fixture.saved, [ confirmed ? [ propertyCorpusEntry ] : [] ]);
            return scope.assert.collect();
        }
    }),
    test(
        'skips cases without property evidence while retaining cache diagnostics on invocations',
        async function (scope) {
            const fixture = await corpusExecution('diagnostics', true);
            const ordinary = runResultFactory
                .build({ perTest: [ { id: { file: null, suite: [], title: 'ordinary', params: null } } ] })
                .perTest;
            const original = confirmedWitnessResult(true);
            const result = { ...original, perTest: [ ...original.perTest, ...ordinary ] };
            const saved = await fixture.execution.persist(fixture.run, result);
            scope.assert.deepEqual<unknown, unknown>(corpusDiagnostics(saved), [ {
                reason: 'Cache entry incompatible.',
                observation: null
            } ]);
            scope.assert.equal(saved.perTest[1], ordinary[0]);
            scope.assert.deepEqual<unknown, unknown>(corpusDiagnostics(original), []);
            return scope.assert.collect();
        }
    ),
    test('preserves corpus read failures for collection diagnostics', async function (scope) {
        const fixture = await corpusExecution('read-error', true);
        await scope.assert.rejects(async function () {
            await fixture.execution.resolve(fixture.run);
        }, { exact: fixture.failure });
        return scope.assert.collect();
    }),
    test('records corpus write failures without losing the completed cases', async function (scope) {
        const fixture = await corpusExecution('write-error', true);
        const result = confirmedWitnessResult(true);
        const saved = await fixture.execution.persist(fixture.run, result);
        scope.assert.equal(saved.status, 'failed');
        scope.assert.partialDeepEqual(saved.runnerErrors, [ {
            message: 'Failed to write property corpus.',
            cause: fixture.failure,
            subtype: 'runtime-state'
        } ]);
        scope.assert.equal(saved.perTest, result.perTest);
        return scope.assert.collect();
    })
]);
