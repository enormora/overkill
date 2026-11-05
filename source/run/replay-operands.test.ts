import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from '../config/config.ts';
import { orchestrator } from '../packages/run/run.entry-point.ts';
import { createReplayCommands } from './replay-commands.ts';

export const testNode = suite('replay command operands', [
    ...[
        { command: 'replayRun', args: [], message: 'Replay requires one retained run id.' },
        { command: 'replayRun', args: [ 'first', 'second' ], message: 'Replay requires one retained run id.' },
        { command: 'replayWitness', args: [], message: 'Witness replay requires a path and --profile.' },
        {
            command: 'replayWitness',
            args: [ 'witness.json' ],
            message: 'Witness replay requires a path and --profile.'
        },
        {
            command: 'replayWitness',
            args: [ 'witness.json', 'cases', 'extra' ],
            message: 'Witness replay requires a path and --profile.'
        }
    ]
        .map(function invalidOperands(entry) {
            return test(
                `${entry.command} rejects ${entry.args.length} operands before loading config`,
                async function (scope: TestScope) {
                    const commands = createReplayCommands(async function unexpectedConfig() {
                        throw new Error('Must validate operands before config.');
                    }, orchestrator);
                    const command = entry.command === 'replayRun' ? commands.replayRun : commands.replayWitness;
                    const result = await command({ cwd: process.cwd(), configPath: null, arguments: entry.args });
                    scope.assert.equal(result.exitCode, 3);
                    scope.assert.includes(result.fallbackDiagnostics.join('\n'), entry.message);
                    return scope.assert.collect();
                }
            );
        }),
    test(
        'routes witness operands through the public operation and reports missing input',
        async function (scope: TestScope) {
            const commands = createReplayCommands(async function config() {
                return { ...normalizeConfig({}), configPath: null };
            }, orchestrator);
            const result = await commands.replayWitness({
                cwd: process.cwd(),
                configPath: null,
                arguments: [ 'missing-replay-input.json', 'cases' ]
            });
            scope.assert.equal(result.exitCode, 3);
            scope.assert.includes(result.fallbackDiagnostics.join('\n'), 'Cannot read replay input');
            return scope.assert.collect();
        }
    )
]);
await runIfMain(import.meta, testNode);
