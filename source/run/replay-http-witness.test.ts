import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { SimulationWitnessFile } from '../engine/witness-file.ts';
import { defineResource } from '../resources/resources.ts';
import { withHttpSimulationWitness } from '../resources/simulated-http-witness.ts';
import { restoreResourceWitness } from '../resources/witness-replay.ts';
import { emptyTranscriptView } from '../transcript/http-transcript.ts';

const handle = { transcript: emptyTranscriptView() };
const resource = withHttpSimulationWitness(
    defineResource({
        name: 'http',
        scope: 'per-case',
        requirements: [],
        dispose: null,
        acquire() {
            return handle;
        }
    }),
    'api'
);
const witness: SimulationWitnessFile = {
    version: 1,
    producedBy: { library: 'http', libraryVersion: '1' },
    case: { file: 'case.test.ts', suite: [], title: 'http', params: null },
    kind: 'simulation',
    seed: null,
    resource: { name: 'http' },
    simulation: { name: 'api', payload: { version: 1, scenarios: { api: 'outage' }, interactions: [] } },
    scenario: 'outage',
    runtimeSnapshot: null,
    faultConfiguration: null
};
async function restore(value: SimulationWitnessFile, signal: AbortSignal): Promise<void> {
    await restoreResourceWitness(resource, { handle, witness: value, signal, seed: null });
}
export const testNode = suite('HTTP witness compatibility', [
    ...[
        { title: 'another simulation', value: { ...witness, simulation: { ...witness.simulation, name: 'other' } } },
        { title: 'a runtime snapshot', value: { ...witness, runtimeSnapshot: {} } },
        { title: 'fault configuration', value: { ...witness, faultConfiguration: {} } },
        { title: 'a random seed', value: { ...witness, seed: '42' } }
    ]
        .map(function unsupported(entry) {
            return test(`rejects ${entry.title}`, async function (scope: TestScope) {
                await scope.assert.rejects(async function incompatible() {
                    await restore(entry.value, AbortSignal.any([]));
                }, { message: 'HTTP simulation witness contains unsupported replay inputs.' });
                return scope.assert.collect();
            });
        }),
    ...[ null, { version: 2, scenarios: {}, interactions: [] } ].map(function invalidPayload(payload) {
        return test(`rejects incompatible payload ${JSON.stringify(payload)}`, async function (scope: TestScope) {
            await scope.assert.rejects(async function incompatible() {
                await restore(
                    { ...witness, simulation: { ...witness.simulation, payload } },
                    AbortSignal.any([])
                );
            }, { name: 'ZodError' });
            return scope.assert.collect();
        });
    }),
    test('rejects conflicting scenario metadata', async function (scope: TestScope) {
        await scope.assert.rejects(async function incompatible() {
            await restore({ ...witness, scenario: 'default' }, AbortSignal.any([]));
        }, { message: 'HTTP simulation witness scenario metadata is inconsistent.' });
        return scope.assert.collect();
    }),
    ...[ witness, {
        ...witness,
        scenario: null,
        simulation: { ...witness.simulation, payload: { version: 1, scenarios: {}, interactions: [] } }
    } ]
        .map(function supported(value) {
            return test(`accepts scenario ${value.scenario}`, async function (scope: TestScope) {
                await restore(value, AbortSignal.any([]));
                scope.assert.deepEqual(handle.transcript.entries, []);
                return scope.assert.collect();
            });
        }),
    test('honors cancellation before restoring HTTP state', async function (scope: TestScope) {
        await scope.assert.rejects(async function cancelled() {
            await restore(witness, AbortSignal.abort(new Error('cancelled replay')));
        }, { message: 'cancelled replay' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
