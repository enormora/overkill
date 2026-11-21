import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { packageVersion } from '../../../package-version.ts';
import type { SimulationWitnessFile } from '../../../engine/witness-file.ts';
import { defineResource } from '../../../resources/resources.ts';
import { withHttpSimulationWitness } from '../../../resources/simulated-http-witness.ts';
import { restoreResourceWitness } from '../../../resources/witness-replay.ts';
import { emptyTranscriptView } from '../../../transcript/http-transcript.ts';

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
const producer = await packageVersion(import.meta.url);
if (producer === null) {
    throw new Error('Expected package metadata.');
}

const witness: SimulationWitnessFile = {
    version: 1,
    producedBy: { library: producer.name, libraryVersion: '0.0.0-retained' },
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
export const testNode: TestNode = suite('HTTP witness compatibility', [
    test('rejects a foreign producer with a compatible HTTP payload', async function (scope) {
        await scope.assert.rejects(async function incompatible() {
            await restore({ ...witness, producedBy: { library: 'foreign', libraryVersion: '1' } }, AbortSignal.any([]));
        }, { message: 'HTTP simulation witness producer is incompatible.' });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid HTTP witnesses',
        cases: [
            {
                title: 'another simulation',
                value: { ...witness, simulation: { ...witness.simulation, name: 'other' } }
            },
            { title: 'a runtime snapshot', value: { ...witness, runtimeSnapshot: {} } },
            { title: 'fault configuration', value: { ...witness, faultConfiguration: {} } },
            { title: 'a random seed', value: { ...witness, seed: '42' } }
        ],
        caseTitle(entry) {
            return entry.title;
        },
        async test(scope) {
            const entry = scope.parameters;

            await scope.assert.rejects(async function incompatible() {
                await restore(entry.value, AbortSignal.any([]));
            }, { message: 'HTTP simulation witness contains unsupported replay inputs.' });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects incompatible replay payloads',
        cases: [ null, { version: 2, scenarios: {}, interactions: [] } ],
        caseTitle(payload) {
            return JSON.stringify(payload);
        },
        async test(scope) {
            const payload = scope.parameters;

            await scope.assert.rejects(async function incompatible() {
                await restore(
                    { ...witness, simulation: { ...witness.simulation, payload } },
                    AbortSignal.any([])
                );
            }, { name: 'ZodError' });
            return scope.assert.collect();
        }
    }),
    test('rejects conflicting scenario metadata', async function (scope) {
        await scope.assert.rejects(async function incompatible() {
            await restore({ ...witness, scenario: 'default' }, AbortSignal.any([]));
        }, { message: 'HTTP simulation witness scenario metadata is inconsistent.' });
        return scope.assert.collect();
    }),
    table({
        title: 'accepts compatible replay scenarios',
        cases: [ witness, {
            ...witness,
            scenario: null,
            simulation: { ...witness.simulation, payload: { version: 1, scenarios: {}, interactions: [] } }
        } ],
        caseTitle(value) {
            return String(value.scenario);
        },
        async test(scope) {
            const value = scope.parameters;

            await restore(value, AbortSignal.any([]));
            scope.assert.deepEqual(handle.transcript.entries, []);
            return scope.assert.collect();
        }
    }),
    test('honors cancellation before restoring HTTP state', async function (scope) {
        await scope.assert.rejects(async function cancelled() {
            await restore(witness, AbortSignal.abort(new Error('cancelled replay')));
        }, { message: 'cancelled replay' });
        return scope.assert.collect();
    })
]);
