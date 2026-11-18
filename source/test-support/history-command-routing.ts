import { createHistoryCommandSet } from '../run/history-commands.ts';
import type { HistoryCommands, HistoryCommandRequest } from '../run/command-line-command.ts';
import { defaultRunConfig } from './run-command-factory.ts';
import { idleHistoryScenario } from './history-access.ts';
import { historyPolicy } from './history-policy.ts';

type HistoryCommandRouting = {
    readonly commands: HistoryCommands;
    readonly request: HistoryCommandRequest;
    readonly events: readonly string[];
    readonly removed: readonly string[];
};
export async function historyCommandRouting(
    confirmed: boolean,
    failure: 'canonical' | 'load' | 'none'
): Promise<HistoryCommandRouting> {
    const fixture = await historyPolicy(idleHistoryScenario, 'available', 'current');
    const events: string[] = [];
    return {
        removed: fixture.removed,
        events,
        request: { cwd: '/workspace', configPath: null, dryRun: false, yes: false },
        commands: createHistoryCommandSet(async function () {
            events.push('load');
            if (failure === 'load') {
                throw new Error('configuration failed');
            }
            return { ...defaultRunConfig({}), configPath: null };
        }, {
            async canonical() {
                events.push('canonical');
                if (failure === 'canonical') {
                    throw new Error('canonicalization failed');
                }
                return '/project';
            },
            create(options) {
                events.push(`create:${options.projectRoot}`);
                return fixture.history;
            },
            async confirm(yes) {
                events.push(`confirm:${String(yes)}`);
                return confirmed;
            }
        })
    };
}
