import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { emptyPropertyCorpus } from '../engine/property-corpus.ts';
import type { WitnessFile } from '../engine/witness-file.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { workerReplayRecord } from '../test-support/replay-record-fixture.ts';
import { createCollectedPlan, fakeWorkerRuntime } from '../test-support/worker-pool-execution-state.ts';
import type { CollectedRunPlan } from './run-types.ts';
import { replayExecutionPlan, withReplay, replayPlacementPlan, currentReplaySignal } from './replay-context.ts';
import { wirePropertyCorpus, withReplayWire } from './replay-wire.ts';

const simulation: WitnessFile = {
    version: 1,
    producedBy: { library: 'counter', libraryVersion: '1' },
    case: propertyCorpusEntry.case,
    kind: 'simulation',
    seed: null,
    simulation: { name: 'counter', payload: null },
    resource: null,
    scenario: null,
    runtimeSnapshot: null,
    faultConfiguration: null
};
function collectionWithCopies(count: number, resourceCount: number): CollectedRunPlan {
    const source = createCollectedPlan();
    return {
        ...source,
        files: source.files.map(function selectedFile(file) {
            return {
                ...file,
                cases: Array.from({ length: count }, function selectedCase() {
                    const original = file.cases[0];
                    if (original === undefined) {
                        throw new Error('Expected fixture case.');
                    }
                    return {
                        ...original,
                        resourceAttachments: {
                            ...original.resourceAttachments,
                            resourceGraph: Array.from({ length: resourceCount }, function counterResource() {
                                return {
                                    name: 'counter',
                                    dependencies: [],
                                    handleTransport: 'local' as const,
                                    scope: 'per-case',
                                    workload: 'independent' as const,
                                    requirements: [],
                                    scenarios: []
                                };
                            })
                        }
                    };
                })
            };
        })
    };
}
async function selectedWitness(value: WitnessFile, execute: () => Promise<void>): Promise<void> {
    await withReplay({ kind: 'witness', witness: value, sourceRunId: null, moduleGraph: 'current' }, null, execute);
}
export const testNode: TestNode = suite('replay target selection', [
    test('restores recorded order and placement with the invocation signal', async function (scope: TestScope) {
        const runtime = fakeWorkerRuntime(createCollectedPlan());
        const record = workerReplayRecord(runtime, null);
        const controller = new AbortController();
        await withReplay({ kind: 'record', record }, controller.signal, async function () {
            const result = replayExecutionPlan(runtime.collectedPlan);
            scope.require.defined(result);
            scope.assert.deepEqual(
                result.orderedCases.map(function (entry) {
                    return entry.workId;
                }),
                record.identities
            );
            scope.assert.equal(currentReplaySignal(), controller.signal);
            const placement = runtime.resolvedRun.facts.execution.placementPlan;
            scope.require.defined(placement);
            scope.assert.deepEqual(replayPlacementPlan(runtime.resolvedRun, placement), placement);
        });
        scope.assert.equal(currentReplaySignal(), null);
        return scope.assert.collect();
    }),
    test(
        'accepts explicit simulation resource names independently of simulation names',
        async function (scope) {
            await selectedWitness({
                ...simulation,
                simulation: { name: 'other', payload: null },
                resource: { name: 'counter' }
            }, async function () {
                scope.assert.equal(replayExecutionPlan(collectionWithCopies(1, 1)), null);
            });
            return scope.assert.collect();
        }
    ),
    test(
        'rejects nested property replay after its declaration changes kind',
        async function (scope) {
            await selectedWitness({
                ...propertyCorpusEntry,
                target: { kind: 'forall', location: { kind: 'unknown' }, occurrence: 0, key: null }
            }, async function () {
                scope.assert.throws(function () {
                    replayExecutionPlan(collectionWithCopies(1, 0));
                }, { message: 'Witness property target no longer matches its declaration.' });
            });
            return scope.assert.collect();
        }
    ),
    table({
        title: 'requires a witness to select exactly one case',
        cases: [ 0, 2 ],
        caseTitle: String,
        async test(scope) {
            const count = scope.parameters;

            await selectedWitness(propertyCorpusEntry, async function select() {
                scope.assert.throws(function resolve() {
                    replayExecutionPlan(collectionWithCopies(count, 0));
                }, { message: 'Witness replay target is missing or ambiguous.' });
            });
            return scope.assert.collect();
        }
    }),
    test('rejects a property witness after its declaration changes family', async function (scope) {
        await selectedWitness(propertyCorpusEntry, async function select() {
            scope.assert.throws(function resolve() {
                replayExecutionPlan(collectionWithCopies(1, 0));
            }, { message: 'Witness property target no longer matches its declaration.' });
        });
        return scope.assert.collect();
    }),
    table({
        title: 'requires exactly one matching simulation resource',
        cases: [ 0, 2 ],
        caseTitle: String,
        async test(scope) {
            const count = scope.parameters;

            await selectedWitness(simulation, async function select() {
                scope.assert.throws(function resolve() {
                    replayExecutionPlan(collectionWithCopies(1, count));
                }, { message: 'Simulation witness resource is missing or ambiguous.' });
            });
            return scope.assert.collect();
        }
    }),
    test('accepts one matching simulation resource by its simulation name', async function (scope) {
        await selectedWitness(simulation, async function select() {
            scope.assert.equal(replayExecutionPlan(collectionWithCopies(1, 1)), null);
        });
        return scope.assert.collect();
    }),
    test('rejects recorded order after selected case metadata disappears', async function (scope) {
        const record = workerReplayRecord(fakeWorkerRuntime(createCollectedPlan()), null);
        await withReplay({ kind: 'record', record }, null, async function select() {
            scope.assert.throws(function resolve() {
                replayExecutionPlan(collectionWithCopies(0, 0));
            }, { message: 'Recorded work is missing its case metadata.' });
        });
        return scope.assert.collect();
    }),
    test(
        'passes a property witness from a wire replay into the property corpus',
        async function (scope) {
            const wire = { kind: 'witness', witness: propertyCorpusEntry, moduleGraph: 'fresh' } as const;
            await withReplayWire(wire, async function select() {
                scope.assert.deepEqual(wirePropertyCorpus(wire), {
                    ...emptyPropertyCorpus,
                    replay: propertyCorpusEntry
                });
            });
            scope.assert.deepEqual(wirePropertyCorpus(null), emptyPropertyCorpus);
            return scope.assert.collect();
        }
    )
]);
