import { realpath } from 'node:fs/promises';
import { posix as path } from 'node:path';
import { createPerformanceBaselineStore } from '../baselines/performance-store.ts';
import { readPerformanceBaselineReport } from '../baselines/performance-report.ts';
import type { BaselineEntry } from '../baselines/performance-baseline.ts';
import type { BenchmarkProfileConfig } from '../config/types.ts';
import { RunCollectionError } from './run-errors.ts';
import { selectBenchmarkProfile } from './test-profile.ts';
import type {
    BenchmarkBaselineCommand,
    BenchmarkBaselineListCommand,
    BenchmarkBaselineRunResult,
    RunCommand,
    RunOrchestrator
} from './run-types.ts';
import type { RunInvocationTimingOptions } from './run-timing-collection.ts';

type ExecutingBaselineVerb = 'apply' | 'bootstrap' | 'diff' | 'update';

type BenchmarkBaselineInvocation = {
    readonly command: BenchmarkBaselineCommand;
    readonly operations: Pick<RunOrchestrator, 'runWithReporterDelivery'>;
    readonly options: RunInvocationTimingOptions;
    readonly verb: ExecutingBaselineVerb;
};

export async function runBenchmarkBaselineVerb(
    input: BenchmarkBaselineInvocation
): Promise<BenchmarkBaselineRunResult> {
    const command: RunCommand = {
        ...input.command,
        request: { ...input.command.request, baselineUpdateMode: input.verb }
    };
    const delivery = await input.operations.runWithReporterDelivery(command, input.options);
    const report = readPerformanceBaselineReport(delivery.result);
    return {
        ...delivery,
        changes: report?.changes ?? [],
        writeOutcome: report?.writeOutcome ?? { kind: 'blocked' }
    };
}

function matchesSourcePath(file: string | null, paths: readonly string[]): boolean {
    if (paths.length === 0) {
        return true;
    }
    if (file === null) {
        return false;
    }
    return paths.some(function matchesPath(operand) {
        const normalized = path.normalize(operand.replaceAll('\\', '/')).replace(/\/$/u, '');
        return file === normalized || file.startsWith(`${normalized}/`) || path.matchesGlob(file, normalized);
    });
}

async function readSelectedBaselines(
    command: BenchmarkBaselineListCommand,
    profile: BenchmarkProfileConfig
): Promise<readonly BaselineEntry[]> {
    const store = await createPerformanceBaselineStore({
        directory: profile.baselines.directory,
        maxBytes: profile.attachments.maxArtifactBytes,
        projectRoot: await realpath(command.cwd)
    });
    const entries = await store.list();
    return entries.filter(function selectedEntry(entry) {
        return entry.baseline.profile.normalize('NFC') === command.request.profile.normalize('NFC') &&
            matchesSourcePath(entry.baseline.work.case.file, command.request.paths);
    });
}

export async function listBenchmarkBaselines(command: BenchmarkBaselineListCommand): Promise<readonly BaselineEntry[]> {
    const profile = selectBenchmarkProfile(command.request.profile, command.config);
    try {
        return await readSelectedBaselines(command, profile);
    } catch (error: unknown) {
        throw new RunCollectionError(
            error instanceof Error ? error.message : String(error),
            { cause: error },
            'artifact'
        );
    }
}
