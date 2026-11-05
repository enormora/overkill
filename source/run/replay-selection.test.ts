import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { emptyPropertyCorpus } from '../engine/property-corpus.ts';
import type { WitnessFile } from '../engine/witness-file.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { workerReplayRecord } from '../test-support/replay-record-fixture.ts';
import type { CollectedRunPlan } from './run-types.ts';
import { createCollectedPlan, fakeWorkerRuntime } from './worker-pool-execution-state.test.ts';
import { replayExecutionPlan, withReplay } from './replay-context.ts';
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
export const testNode = suite('replay target selection', [
    ...[ 0, 2 ].map(function invalidSelection(count) {
        return test(`rejects a witness selecting ${count} cases`, async function (scope: TestScope) {
            await selectedWitness(propertyCorpusEntry, async function select() {
                scope.assert.throws(function resolve() {
                    replayExecutionPlan(collectionWithCopies(count, 0));
                }, { message: 'Witness replay target is missing or ambiguous.' });
            });
            return scope.assert.collect();
        });
    }),
    test('rejects a property witness after its declaration changes family', async function (scope: TestScope) {
        await selectedWitness(propertyCorpusEntry, async function select() {
            scope.assert.throws(function resolve() {
                replayExecutionPlan(collectionWithCopies(1, 0));
            }, { message: 'Witness property target no longer matches its declaration.' });
        });
        return scope.assert.collect();
    }),
    ...[ 0, 2 ].map(function invalidResources(count) {
        return test(`rejects a simulation witness with ${count} matching resources`, async function (scope: TestScope) {
            await selectedWitness(simulation, async function select() {
                scope.assert.throws(function resolve() {
                    replayExecutionPlan(collectionWithCopies(1, count));
                }, { message: 'Simulation witness resource is missing or ambiguous.' });
            });
            return scope.assert.collect();
        });
    }),
    test('accepts one matching simulation resource by its simulation name', async function (scope: TestScope) {
        await selectedWitness(simulation, async function select() {
            scope.assert.equal(replayExecutionPlan(collectionWithCopies(1, 1)), null);
        });
        return scope.assert.collect();
    }),
    test('rejects recorded order after selected case metadata disappears', async function (scope: TestScope) {
        const record = workerReplayRecord(fakeWorkerRuntime(createCollectedPlan()), null);
        await withReplay({ kind: 'record', record }, null, async function select() {
            scope.assert.throws(function resolve() {
                replayExecutionPlan(collectionWithCopies(0, 0));
            }, { message: 'Recorded work is missing its case metadata.' });
        });
        return scope.assert.collect();
    }),
    test('passes a property witness from a wire replay into the property corpus', async function (scope: TestScope) {
        const wire = { kind: 'witness', witness: propertyCorpusEntry, moduleGraph: 'fresh' } as const;
        await withReplayWire(wire, async function select() {
            scope.assert.deepEqual(wirePropertyCorpus(wire), { ...emptyPropertyCorpus, replay: propertyCorpusEntry });
        });
        scope.assert.deepEqual(wirePropertyCorpus(null), emptyPropertyCorpus);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
