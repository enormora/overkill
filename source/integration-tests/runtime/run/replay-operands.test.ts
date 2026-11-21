import { table, suite, test } from '@overkill-dev/test';

import { normalizeConfig } from '../../../config/config.ts';
import { orchestrator } from '../../../packages/run/run.entry-point.ts';
import { createReplayCommands } from '../../../run/replay-commands.ts';

export const testNode = suite('replay command operands', [
    table({
        title: 'rejects invalid operand counts before loading configuration',
        cases: [
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
        ],
        caseTitle(entry) {
            return `${entry.command}, ${entry.args.length}`;
        },
        async test(scope) {
            const entry = scope.parameters;

            const commands = createReplayCommands(async function unexpectedConfig() {
                throw new Error('Must validate operands before config.');
            }, orchestrator);
            const command = entry.command === 'replayRun' ? commands.replayRun : commands.replayWitness;
            const result = await command({ cwd: process.cwd(), configPath: null, arguments: entry.args });
            scope.assert.equal(result.exitCode, 3);
            scope.assert.includes(result.fallbackDiagnostics.join('\n'), entry.message);
            return scope.assert.collect();
        }
    }),
    test(
        'routes witness operands through the public operation and reports missing input',
        async function (scope) {
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
