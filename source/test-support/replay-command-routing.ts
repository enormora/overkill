import { createReplayCommands, type ReplayCommands } from '../run/replay-commands.ts';
import type { ReplayOperations } from '../run/replay-types.ts';
import type { CommandLineCommandContext } from '../run/command-line-command.ts';
import { normalizeConfig } from '../config/config.ts';
import { baselineCaseResult } from './baseline-case-fixture.ts';

type ReplayCommandFixture = {
    readonly commands: ReplayCommands;
    readonly context: CommandLineCommandContext;
    readonly calls: readonly { readonly kind: string; readonly command: unknown; }[];
};
export function replayCommandRouting(failure: 'execute' | 'load' | 'none'): ReplayCommandFixture {
    const calls: { readonly kind: string; readonly command: unknown; }[] = [];
    const result = {
        context: { id: null, startedAt: null, facts: null },
        ...baselineCaseResult,
        maintenanceDiagnostics: [ 'maintenance diagnostic' ]
    };
    function dispatch(kind: string): ReplayOperations['replayWithReporterDelivery'] {
        return async function (command) {
            calls.push({ kind, command });
            if (failure === 'execute') {
                throw new Error('replay failed');
            }
            return { result, deliveredRunnerErrors: [], undeliveredRunnerErrors: [] };
        };
    }
    const operations: ReplayOperations = {
        async replay() {
            throw new Error('Replay must track reporter delivery.');
        },
        async replayWitness() {
            throw new Error('Witness replay must track reporter delivery.');
        },
        replayWithReporterDelivery: dispatch('record'),
        async replayWitnessWithReporterDelivery(command: unknown) {
            calls.push({ kind: 'witness', command });
            if (failure === 'execute') {
                throw new Error('replay failed');
            }
            return { result, deliveredRunnerErrors: [], undeliveredRunnerErrors: [] };
        }
    };
    return {
        calls,
        context: { cwd: '/project', configPath: null, arguments: [ 'run' ] },
        commands: createReplayCommands(async function () {
            if (failure === 'load') {
                throw new Error('configuration failed');
            }
            return { ...normalizeConfig({}), reporters: [], configPath: null };
        }, operations)
    };
}
