import { realpath } from 'node:fs/promises';
import { posix as path } from 'node:path';
import { createPerformanceBaselineStore } from '../baselines/performance-store.ts';
import type { BaselineEntry } from '../baselines/performance-baseline.ts';
import type { BenchmarkProfileConfig } from '../config/types.ts';
import { RunCollectionError } from './run-errors.ts';
import { selectBenchmarkProfile } from './test-profile.ts';
import type {
    BenchmarkBaselineListCommand
} from './run-types.ts';

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
