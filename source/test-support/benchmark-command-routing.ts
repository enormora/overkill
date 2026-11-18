import type { CommandLineBenchmarkCommands, CommandLineBenchmarkRunRequest } from '../run/command-line-command.ts';
import { normalizeConfig } from '../config/config.ts';
import { createBenchmarkCommands } from '../run/benchmark-commands.ts';
import type { BenchmarkCommandDependencies } from '../run/benchmark-command-policy.ts';
import type { BenchmarkBaselineRunResult } from '../run/run-types.ts';
import { calibrationReferenceReportArtifact } from '../bench/calibration-report.ts';
import { createNullReporter } from '../reporters/null-reporter.ts';
import { baselineCaseResult } from './baseline-case-fixture.ts';
import { storedPerformanceFixture } from './performance-storage.ts';
import { defaultRunRequest } from './run-command-factory.ts';

type BenchmarkCommandCall = { readonly verb: string; readonly profile: string | null; };
type BenchmarkCommandRouting = {
    readonly dependencies: BenchmarkCommandDependencies;
    readonly commands: CommandLineBenchmarkCommands;
    readonly calls: readonly BenchmarkCommandCall[];
    readonly request: CommandLineBenchmarkRunRequest;
};
export function benchmarkCommandRouting(failure: Error | null): BenchmarkCommandRouting {
    const calls: BenchmarkCommandCall[] = [];
    const defaultReporter = createNullReporter();
    const result = {
        ...baselineCaseResult,
        maintenanceDiagnostics: [],
        artifacts: [
            calibrationReferenceReportArtifact({
                result: baselineCaseResult,
                report: {
                    version: 1,
                    changes: [ { kind: 'write', path: 'calibration/reference.json' } ],
                    completed: [ 'calibration/reference.json' ],
                    outcome: 'written'
                },
                maxBytes: 65_536,
                capturedAtMicroseconds: 0
            })
        ]
    };
    const baselineResult: BenchmarkBaselineRunResult = {
        writeOutcome: { kind: 'read-only' },
        result,
        changes: [ { kind: 'create', baseline: storedPerformanceFixture } ],
        calibrationChanges: [ { kind: 'write', path: 'calibration/reference.json' } ],
        deliveredRunnerErrors: [],
        undeliveredRunnerErrors: []
    };
    function baseline(verb: string): BenchmarkCommandDependencies['orchestrator']['bench']['baseline']['diff'] {
        return async function dispatch(command) {
            calls.push({ verb, profile: command.request.profile });
            return baselineResult;
        };
    }
    const dependencies: BenchmarkCommandDependencies = {
        async createDefaultReporter() {
            return defaultReporter;
        },
        async loadConfig() {
            if (failure !== null) {
                throw failure;
            }
            return {
                ...normalizeConfig({
                    profiles: {
                        bench: {
                            testFamily: 'benchmark',
                            files: { include: [ 'subject.bench.ts' ] },
                            execution: { processModel: 'supervised-process' }
                        }
                    }
                }),
                configPath: null
            };
        },
        orchestrator: {
            bench: {
                async list() {
                    throw new Error('Unexpected benchmark collection.');
                },
                async run() {
                    return result;
                },
                async runWithReporterDelivery(command) {
                    calls.push({ verb: 'run', profile: command.request.profile });
                    return { result, deliveredRunnerErrors: [], undeliveredRunnerErrors: [] };
                },
                async calibrate(command) {
                    calls.push({ verb: 'calibrate', profile: command.request.profile });
                    return { result, deliveredRunnerErrors: [], undeliveredRunnerErrors: [] };
                },
                baseline: {
                    apply: baseline('apply'),
                    bootstrap: baseline('bootstrap'),
                    diff: baseline('diff'),
                    update: baseline('update'),
                    async list() {
                        return [ {
                            path: 'baselines/performance/reference.benchmark.json',
                            baseline: storedPerformanceFixture
                        } ];
                    }
                }
            }
        }
    };
    return {
        dependencies,
        commands: createBenchmarkCommands(dependencies),
        calls,
        request: { configPath: null, cwd: '/project', runRequest: defaultRunRequest({ profile: 'bench' }) }
    };
}
