import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { SimulationWitnessFile } from '../engine/witness-file.ts';
import { defineResource } from '../resources/resources.ts';
import { acquisitionResourceScenarioBindings } from '../resources/resource-scenario-binding.ts';
import { withWitnessReplay } from '../resources/witness-replay.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { withReplay } from './replay-context.ts';
import { replayAcquiredResource, replayResourceDefinition } from './replay-resource.ts';

import { testNode as http } from './replay-http-witness.test.ts';

const resource = defineResource({
    name: 'counter',
    scope: 'per-case',
    requirements: [],
    acquire() {
        return { value: 0 };
    },
    dispose: null,
    scenarios: { mode: { timing: 'acquire', values: [ 'normal', 'outage' ], default: 'normal' } }
});
const witness: SimulationWitnessFile = {
    version: 1,
    producedBy: { library: 'counter', libraryVersion: '1' },
    case: { file: 'case.test.ts', suite: [], title: 'counter', params: null },
    kind: 'simulation',
    seed: '-7',
    simulation: { name: 'mode', payload: { value: 42 } },
    resource: { name: 'counter' },
    scenario: 'outage',
    runtimeSnapshot: null,
    faultConfiguration: null
};
async function withWitness(value: SimulationWitnessFile, execute: () => Promise<void>): Promise<void> {
    await withReplay({ kind: 'witness', witness: value, sourceRunId: null, moduleGraph: 'current' }, null, execute);
}
export const testNode = suite('replay resource restoration', [
    http,
    test('preserves resources outside replay', async function (scope: TestScope) {
        scope.assert.equal(replayResourceDefinition(resource), resource);
        await replayAcquiredResource(resource, {}, AbortSignal.abort());
        return scope.assert.collect();
    }),
    test('preserves resources during property replay', async function (scope: TestScope) {
        await withReplay(
            { kind: 'witness', witness: propertyCorpusEntry, sourceRunId: null, moduleGraph: 'current' },
            null,
            async function propertyReplay() {
                scope.assert.equal(replayResourceDefinition(resource), resource);
                await replayAcquiredResource(resource, {}, AbortSignal.abort());
            }
        );
        return scope.assert.collect();
    }),
    ...[
        { title: 'ignores another resource', value: { ...witness, resource: { name: 'other' } } },
        { title: 'keeps a witness without a scenario', value: { ...witness, scenario: null } }
    ]
        .map(function unchanged(entry) {
            return test(entry.title, async function (scope: TestScope) {
                await withWitness(entry.value, async function replay() {
                    scope.assert.equal(replayResourceDefinition(resource), resource);
                });
                return scope.assert.collect();
            });
        }),
    test('restores the recorded scenario', async function (scope: TestScope) {
        await withWitness(witness, async function replay() {
            scope.assert.deepEqual(acquisitionResourceScenarioBindings(replayResourceDefinition(resource)), {
                mode: 'outage'
            });
        });
        return scope.assert.collect();
    }),
    ...[
        { scenario: 'missing', name: 'mode' },
        { scenario: 'outage', name: 'missing' }
    ]
        .map(function unavailable({ scenario, name }) {
            return test(`rejects unavailable scenario ${scenario}`, async function (scope: TestScope) {
                await withWitness(
                    { ...witness, scenario, simulation: { ...witness.simulation, name } },
                    async function replay() {
                        scope.assert.throws(function restore() {
                            replayResourceDefinition(resource);
                        }, { message: `Simulation witness scenario is unavailable: ${scenario}` });
                    }
                );
                return scope.assert.collect();
            });
        }),
    test('requires a restoration callback', async function (scope: TestScope) {
        await withWitness(witness, async function replay() {
            await scope.assert.rejects(async function restore() {
                await replayAcquiredResource(resource, {}, AbortSignal.abort());
            }, { message: 'Resource "counter" does not support simulation witness replay.' });
        });
        return scope.assert.collect();
    }),
    ...[ null, '-7' ].map(function seedValue(seed) {
        return test(`passes the witness and seed ${seed} to restoration`, async function (scope: TestScope) {
            const controller = new AbortController();
            const handle = { value: 0 };
            const selected = {
                ...witness,
                seed,
                resource: null,
                simulation: { ...witness.simulation, name: 'counter' }
            };
            const restorable = withWitnessReplay(resource, function restore(context) {
                scope.assert.equal(context.handle, handle);
                scope.assert.equal(context.signal, controller.signal);
                scope.assert.equal(context.witness, selected);
                scope.assert.equal(context.seed, seed === null ? null : -7n);
                handle.value = 42;
            });
            await withWitness(selected, async function replay() {
                await replayAcquiredResource(restorable, handle, controller.signal);
            });
            scope.assert.equal(handle.value, 42);
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
