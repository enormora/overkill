import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import {
    witnessReplayInput,
    witnessReplayAccess,
    replayPropertyWitness,
    replaySimulationWitness,
    propertyReplayCommand
} from '../test-support/witness-replay-preparation.ts';
import { resolveWitnessReplay, resolvePropertyReplay, propertyWitnessCommand } from './witness-replay-preparation.ts';

export const testNode = authoredSuite('fixed witness replay preparation', [
    authoredTest('builds exact property work selection and verifies its source', async function (scope: TestScope) {
        const fixture = witnessReplayAccess(replayPropertyWitness, null);
        const prepared = await resolveWitnessReplay(witnessReplayInput(), fixture.access);
        scope.assert.deepEqual(fixture.calls, [ 'read:/project/witness.json', 'verify:/project:laws.ts' ]);
        scope.assert.partialDeepEqual(prepared.replay, { kind: 'witness', sourceRunId: null, moduleGraph: 'fresh' });
        const propertyReplay: unknown = Reflect.get(prepared.command, 'propertyReplay');
        scope.assert.deepEqual<unknown, unknown>(propertyReplay, replayPropertyWitness);
        scope.assert.partialDeepEqual(prepared.command.request, {
            seed: { value: 42n },
            paths: [ 'laws.ts' ],
            coverage: false,
            order: 'plan',
            record: true,
            shard: { index: 1, total: 1 },
            selection: {
                kind: 'filter',
                filter: {
                    kind: 'work-id',
                    id: { familyVariant: null, case: replayPropertyWitness.case, runtimes: [], workload: null }
                }
            }
        });
        return scope.assert.collect();
    }),
    authoredTest(
        'builds case selection for simulation witnesses without property state',
        async function (scope: TestScope) {
            const fixture = witnessReplayAccess(replaySimulationWitness, null);
            const prepared = await resolveWitnessReplay(witnessReplayInput(), fixture.access);
            scope.assert.deepEqual(propertyWitnessCommand(replaySimulationWitness), {});
            scope.assert.partialDeepEqual(prepared.command.request, {
                seed: { value: 0n },
                selection: { kind: 'filter', filter: { kind: 'case-id', id: replaySimulationWitness.case } }
            });
            return scope.assert.collect();
        }
    ),
    ...([ null, '/outside.ts', '../escape.ts', 'sub/../escape.ts', 'sub\\..\\escape.ts' ] as const).map(
        function (file) {
            return authoredTest(`rejects invalid witness source ${String(file)}`, async function (scope: TestScope) {
                const fixture = witnessReplayAccess({
                    ...replayPropertyWitness,
                    case: { ...replayPropertyWitness.case, file }
                }, null);
                await scope.assert.rejects(async function () {
                    await resolveWitnessReplay(witnessReplayInput(), fixture.access);
                }, { message: 'Witness must identify a project-relative source module.' });
                scope.assert.deepEqual(fixture.calls, [ 'read:/project/witness.json' ]);
                return scope.assert.collect();
            });
        }
    ),
    authoredTest('retains source validation failures', async function (scope: TestScope) {
        const error = new Error('missing source');
        const fixture = witnessReplayAccess(replayPropertyWitness, error);
        await scope.assert.rejects(async function () {
            await resolveWitnessReplay(witnessReplayInput(), fixture.access);
        }, { exact: error });
        scope.assert.equal(fixture.calls.length, 2);
        return scope.assert.collect();
    }),
    authoredTest(
        'normalizes incompatible witnesses before attempting source access',
        async function (scope: TestScope) {
            const fixture = witnessReplayAccess({ version: 2 }, null);
            await scope.assert.rejects(async function () {
                await resolveWitnessReplay(witnessReplayInput(), fixture.access);
            }, { message: 'Replay input is incompatible or incomplete.' });
            scope.assert.equal(fixture.calls.length, 1);
            return scope.assert.collect();
        }
    ),
    ...([ { path: '.overkill/runs/run-42/witness.json', id: 'run-42' }, { path: '.overkill/runs/run-42', id: null }, {
        path: '../outside/witness.json',
        id: null
    }, { path: '.overkill/runs/invalid.id/witness.json', id: null } ] as const)
        .map(function (entry) {
            return authoredTest(`identifies witness owner for ${entry.path}`, async function (scope: TestScope) {
                const input = witnessReplayInput();
                const fixture = witnessReplayAccess(replayPropertyWitness, null);
                const prepared = await resolveWitnessReplay({
                    ...input,
                    path: entry.path,
                    config: { ...input.config, runtimeStateDir: '.overkill' }
                }, fixture.access);
                scope.assert.partialDeepEqual(prepared.replay, { sourceRunId: entry.id });
                return scope.assert.collect();
            });
        }),
    ...([ null, 'integration' ] as const).map(function (profile) {
        return authoredTest(`resolves requested replay policy ${String(profile)}`, async function (scope: TestScope) {
            const fixture = witnessReplayAccess(replayPropertyWitness, null);
            const command = propertyReplayCommand(profile);
            const prepared = await resolvePropertyReplay(command, fixture.access);
            scope.assert.partialDeepEqual({
                replay: prepared.replay,
                command: {
                    request: prepared.command.request,
                    engine: prepared.command.engine
                }
            }, {
                replay: { moduleGraph: 'current' },
                command: {
                    engine: command.engine,
                    request: {
                        profile: 'integration',
                        seed: { value: 7n },
                        capture: 'live',
                        record: false,
                        timingCollection: 'precise',
                        debug: { mode: 'all', selectors: [] }
                    }
                }
            });
            return scope.assert.collect();
        });
    }),
    authoredTest(
        'requires explicit selection when multiple eligible profiles exist',
        async function (scope: TestScope) {
            const fixture = witnessReplayAccess(replayPropertyWitness, null);
            const command = propertyReplayCommand(null);
            const profile = command.config.profiles.integration;
            scope.require.defined(profile);
            await scope.assert.rejects(async function () {
                await resolvePropertyReplay({
                    ...command,
                    config: { ...command.config, profiles: { first: profile, second: profile } }
                }, fixture.access);
            }, { message: 'Select a configured replay profile with --profile.' });
            scope.assert.deepEqual(fixture.calls, []);
            return scope.assert.collect();
        }
    ),
    authoredTest('rejects unknown replay profiles before reading inputs', async function (scope: TestScope) {
        const fixture = witnessReplayAccess(replayPropertyWitness, null);
        await scope.assert.rejects(async function () {
            await resolvePropertyReplay(propertyReplayCommand('missing'), fixture.access);
        }, { message: 'Select a configured replay profile with --profile.' });
        scope.assert.deepEqual(fixture.calls, []);
        scope.assert.deepEqual(propertyWitnessCommand(null), {});
        return scope.assert.collect();
    })
]);
