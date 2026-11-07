import { realpath } from 'node:fs/promises';
import { createPerformanceBaselineStore } from '../baselines/performance-store.ts';
import type { BaselineEntry } from '../baselines/performance-baseline.ts';
import type { BenchmarkProfileConfig } from '../config/types.ts';
import { matchesBaselineSourcePath } from './baseline-path-selection.ts';
import { RunCollectionError } from './run-errors.ts';
import { selectBenchmarkProfile } from './test-profile.ts';
import type {
    BenchmarkBaselineListCommand
} from './run-types.ts';

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
            matchesBaselineSourcePath(entry.baseline.work.case.file, command.request.paths);
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
