import { formatCaseId } from '../engine/identity.ts';
import type { BaselineChange, BaselineEntry } from '../baselines/performance-baseline.ts';
import { selectBenchmarkCommandProfile, type BenchmarkCommandDependencies } from './benchmark-command-policy.ts';
import { createCommandLineConfig } from './command-line-config.ts';
import {
    commandLineExitCodes,
    createCommandLineErrorResultFromUnknown,
    formatRunnerErrorDiagnostics,
    readExitCodeFromRunResult,
    type CommandLineBenchmarkBaselineListRequest,
    type CommandLineBenchmarkBaselineRequest,
    type CommandLineRunnerResult
} from './command-line-command.ts';
import { createSystemRunTimingMeasurement } from './run-timing-collection.ts';
import type { BenchmarkBaselineRunResult } from './run-types.ts';

type BenchmarkBaselineVerb = 'apply' | 'bootstrap' | 'diff' | 'update';
type BaselineCommandInput = {
    readonly dependencies: BenchmarkCommandDependencies;
    readonly request: CommandLineBenchmarkBaselineRequest;
    readonly verb: BenchmarkBaselineVerb;
};
type BaselineListInput = {
    readonly dependencies: BenchmarkCommandDependencies;
    readonly request: CommandLineBenchmarkBaselineListRequest;
};

function renderChange(change: BaselineChange): string {
    const { baseline } = change;
    const identity = `${baseline.profile}; ${baseline.adapter}; ${baseline.expected.calibration.machineClass}`;
    return `${change.kind} ${formatCaseId(baseline.work.case)} [${identity}]`;
}

function renderEntry(entry: BaselineEntry): string {
    const { baseline } = entry;
    const identity = `${baseline.profile}; ${baseline.adapter}; ${baseline.expected.calibration.machineClass}`;
    return `${entry.path}: ${formatCaseId(baseline.work.case)} [${identity}]`;
}

function baselineCommandResult(
    result: BenchmarkBaselineRunResult,
    verb: BenchmarkBaselineVerb
): CommandLineRunnerResult {
    const runExitCode = readExitCodeFromRunResult(result.result);
    return {
        exitCode: verb === 'diff' && runExitCode === commandLineExitCodes.pass && result.changes.length > 0
            ? commandLineExitCodes.testFailure
            : runExitCode,
        fallbackDiagnostics: formatRunnerErrorDiagnostics(result.undeliveredRunnerErrors),
        runResult: result.result,
        stdoutLines: result.changes.map(renderChange)
    };
}

async function executeBaselineCommand(input: BaselineCommandInput): Promise<CommandLineRunnerResult> {
    const { dependencies, request, verb } = input;
    const timing = createSystemRunTimingMeasurement();
    const loaded = await dependencies.loadConfig(request);
    const profile = selectBenchmarkCommandProfile(request.runRequest.profile, loaded);
    const runRequest = { ...request.runRequest, baselineUpdateMode: 'none' as const, profile };
    const config = await createCommandLineConfig(loaded, { ...request, runRequest }, dependencies);
    const result = await dependencies.orchestrator.bench.baseline[verb]({
        config,
        cwd: request.cwd,
        engine: { kind: 'default' },
        request: { ...request.runRequest, profile }
    }, { timing });
    return baselineCommandResult(result, verb);
}

export async function runBenchmarkBaselineCommand(input: BaselineCommandInput): Promise<CommandLineRunnerResult> {
    try {
        return await executeBaselineCommand(input);
    } catch (error: unknown) {
        return createCommandLineErrorResultFromUnknown(error);
    }
}

export async function listBenchmarkBaselineCommand(input: BaselineListInput): Promise<CommandLineRunnerResult> {
    try {
        const config = await input.dependencies.loadConfig(input.request);
        const profile = selectBenchmarkCommandProfile(input.request.listRequest.profile, config);
        const entries = await input.dependencies.orchestrator.bench.baseline.list({
            config,
            cwd: input.request.cwd,
            request: { paths: input.request.listRequest.paths, profile }
        });
        return {
            exitCode: commandLineExitCodes.pass,
            fallbackDiagnostics: [],
            runResult: null,
            stdoutLines: entries.map(renderEntry)
        };
    } catch (error: unknown) {
        return createCommandLineErrorResultFromUnknown(error);
    }
}
