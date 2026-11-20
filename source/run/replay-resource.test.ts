import { type TestNode, table, suite, test } from '@overkill-dev/test';

import type { SimulationWitnessFile } from '../engine/witness-file.ts';
import { defineResource } from '../resources/resources.ts';
import { acquisitionResourceScenarioBindings } from '../resources/resource-scenario-binding.ts';
import { withWitnessReplay } from '../resources/witness-replay.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { withReplay } from './replay-context.ts';
import { replayAcquiredResource, replayResourceDefinition } from './replay-resource.ts';

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
export const testNode: TestNode = suite('replay resource restoration', [
    test('preserves resources outside replay', async function (scope) {
        scope.assert.equal(replayResourceDefinition(resource), resource);
        await replayAcquiredResource(resource, {}, AbortSignal.abort());
        return scope.assert.collect();
    }),
    test('preserves resources during property replay', async function (scope) {
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
    table({
        title: 'validates replay resource restoration',
        cases: [
            { title: 'ignores another resource', value: { ...witness, resource: { name: 'other' } } },
            { title: 'keeps a witness without a scenario', value: { ...witness, scenario: null } }
        ],
        caseTitle(entry) {
            return entry.title;
        },
        async test(scope) {
            const entry = scope.parameters;

            await withWitness(entry.value, async function replay() {
                scope.assert.equal(replayResourceDefinition(resource), resource);
            });
            return scope.assert.collect();
        }
    }),
    test('restores the recorded scenario', async function (scope) {
        await withWitness(witness, async function replay() {
            scope.assert.deepEqual(acquisitionResourceScenarioBindings(replayResourceDefinition(resource)), {
                mode: 'outage'
            });
        });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects unavailable replay scenarios',
        cases: [
            { scenario: 'missing', name: 'mode' },
            { scenario: 'outage', name: 'missing' }
        ],
        caseTitle({ scenario }) {
            return scenario;
        },
        async test(scope) {
            const { scenario, name } = scope.parameters;

            await withWitness(
                { ...witness, scenario, simulation: { ...witness.simulation, name } },
                async function replay() {
                    scope.assert.throws(function restore() {
                        replayResourceDefinition(resource);
                    }, { message: `Simulation witness scenario is unavailable: ${scenario}` });
                }
            );
            return scope.assert.collect();
        }
    }),
    test('requires a restoration callback', async function (scope) {
        await withWitness(witness, async function replay() {
            await scope.assert.rejects(async function restore() {
                await replayAcquiredResource(resource, {}, AbortSignal.abort());
            }, { message: 'Resource "counter" does not support simulation witness replay.' });
        });
        return scope.assert.collect();
    }),
    table({
        title: 'passes witness and seed to restoration',
        cases: [ null, '-7' ],
        caseTitle: String,
        async test(scope) {
            const seed = scope.parameters;

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
        }
    })
]);
