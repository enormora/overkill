import { createBaselineCommands, type BaselineDependencies } from '../run/baseline-commands.ts';
import type { CommandLineBaselineCommands, CommandLineBaselineRequest } from '../run/command-line-command.ts';
import type { BaselineRunResult } from '../run/baseline-types.ts';
import { normalizeConfig } from '../config/config.ts';
import { createNullReporter } from '../reporters/null-reporter.ts';
import { baselineCaseResult, storedBaseline } from './baseline-case-fixture.ts';
import { defaultRunRequest } from './run-command-factory.ts';

type OrdinaryCommandScenario = { readonly failure: 'execute' | 'list' | 'load' | 'none'; readonly changes: boolean; };
export const ordinaryCommandScenario: OrdinaryCommandScenario = { failure: 'none', changes: true };
type OrdinaryCommandRouting = {
    readonly commands: CommandLineBaselineCommands;
    readonly request: CommandLineBaselineRequest;
    readonly calls: readonly string[];
};
export function ordinaryCommandRouting(scenario: OrdinaryCommandScenario): OrdinaryCommandRouting {
    const calls: string[] = [];
    const result: BaselineRunResult = {
        result: { ...baselineCaseResult, maintenanceDiagnostics: [] },
        changes: scenario.changes ? [ { kind: 'create', baseline: storedBaseline } ] : [],
        warnings: [ 'baseline warning' ],
        writeOutcome: { kind: 'read-only' },
        deliveredRunnerErrors: [],
        undeliveredRunnerErrors: []
    };
    function dispatch(verb: string): BaselineDependencies['orchestrator']['baseline']['diff'] {
        return async function (command) {
            calls.push(`${verb}:${command.request.profile}`);
            if (scenario.failure === 'execute') {
                throw new Error('baseline failed');
            }
            return result;
        };
    }
    const reporter = createNullReporter();
    return {
        calls,
        request: { cwd: '/project', configPath: null, runRequest: defaultRunRequest({ profile: 'unit' }) },
        commands: createBaselineCommands({
            async loadConfig() {
                if (scenario.failure === 'load') {
                    throw new Error('configuration failed');
                }
                return {
                    ...normalizeConfig({
                        profiles: {
                            unit: {
                                testFamily: 'integration',
                                files: { include: [ 'subject.test.ts' ] },
                                execution: { processModel: 'supervised-process' }
                            }
                        }
                    }),
                    reporters: [],
                    configPath: null
                };
            },
            async createDefaultReporter() {
                return reporter;
            },
            orchestrator: {
                baseline: {
                    apply: dispatch('apply'),
                    bootstrap: dispatch('bootstrap'),
                    diff: dispatch('diff'),
                    update: dispatch('update'),
                    async list() {
                        calls.push('list');
                        if (scenario.failure === 'list') {
                            throw new Error('listing failed');
                        }
                        return [ { path: 'baselines/snapshot.baseline.json', baseline: storedBaseline } ];
                    }
                }
            }
        })
    };
}
