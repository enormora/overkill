import { runIfMain } from '#test-runner';
import { commandLineRunner, type CommandLineWitnessReplayRequest } from '../run/command-line.entry-point.ts';
import { suite, test } from './test.entry-point.ts';
import { dispatchOverkillCommand } from './command-line-commands.ts';

export const testNode = suite('witness replay command', [
    test('maps witness replay options to typed runner intent', async function (scope) {
        const requests: CommandLineWitnessReplayRequest[] = [];
        const result = await dispatchOverkillCommand(
            [
                'replay-witness',
                'failure.json',
                '--profile',
                'laws',
                '--seed',
                '42',
                '--record',
                '--timings'
            ],
            async function loadRunner() {
                return {
                    ...commandLineRunner,
                    async replayWitness(request) {
                        requests.push(request);
                        return { exitCode: 0, runResult: null, stdoutLines: [], fallbackDiagnostics: [] };
                    }
                };
            },
            '/project',
            async function () {
                return undefined;
            }
        );
        scope.assert.equal(result.kind, 'command-result');
        scope.assert.deepEqual(requests, [ {
            cwd: '/project',
            configPath: null,
            replayRequest: {
                path: 'failure.json',
                profile: 'laws',
                seed: { value: 42n },
                capture: 'buffered',
                record: true,
                timingCollection: 'precise'
            }
        } ]);
        return scope.assert.collect();
    }),
    test('rejects a missing witness path before loading the runner', async function (scope) {
        const result = await dispatchOverkillCommand(
            [ 'replay-witness' ],
            async function loadUnexpectedRunner() {
                throw new Error('Invalid arguments must not load the runner.');
            },
            '/project',
            async function () {
                return undefined;
            }
        );
        scope.assert.equal(result.kind, 'parser-exit');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
