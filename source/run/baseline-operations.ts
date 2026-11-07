import type { BuiltinTestProfileConfig } from '../config/types.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { matchesBaselineSourcePath } from './baseline-path-selection.ts';
import { RunCollectionError } from './run-errors.ts';
import { selectBaselineProfile } from './test-profile.ts';
import { createOrdinaryBaselineStore } from './baseline-store.ts';
import type { OrdinaryBaselineEntry } from './baseline-record.ts';
import { readOrdinaryBaselineReport, type OrdinaryBaselineReport } from './baseline-report.ts';
import type { RunCommand, RunOperations } from './run-types.ts';
import type { BaselineListCommand, BaselineOrchestrator } from './baseline-types.ts';

async function readSelectedBaselines(
    command: BaselineListCommand,
    profile: BuiltinTestProfileConfig
): Promise<readonly OrdinaryBaselineEntry[]> {
    const limits = profile.testFamily === 'integration' ? profile.attachments : defaultAttachmentLimits;
    const store = await createOrdinaryBaselineStore({
        directory: profile.baselines.directory,
        projectRoot: command.cwd,
        maxBytes: limits.maxArtifactBytes
    });
    const entries = await store.list();
    return entries.filter(function selected(entry) {
        const matchesProfile = entry.baseline.profile.normalize('NFC') === command.request.profile.normalize('NFC');
        return matchesProfile && matchesBaselineSourcePath(entry.baseline.work.case.file, command.request.paths);
    });
}
async function listBaselines(command: BaselineListCommand): Promise<readonly OrdinaryBaselineEntry[]> {
    const profile = selectBaselineProfile(command.request.profile, command.config);
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
export function createBaselineOperations(operations: RunOperations<RunCommand>): BaselineOrchestrator {
    function verb(mode: 'apply' | 'bootstrap' | 'diff' | 'update'): BaselineOrchestrator['update'] {
        return async function executeBaseline(command, options) {
            const delivered = await operations.runWithReporterDelivery({
                ...command,
                request: { ...command.request, baselineUpdateMode: mode }
            }, options);
            const report: OrdinaryBaselineReport = readOrdinaryBaselineReport(delivered.result) ??
                { version: 1, changes: [], warnings: [], writeOutcome: { kind: 'blocked' } };
            return {
                ...delivered,
                changes: report.changes,
                warnings: report.warnings,
                writeOutcome: report.writeOutcome
            };
        };
    }
    return {
        apply: verb('apply'),
        bootstrap: verb('bootstrap'),
        diff: verb('diff'),
        list: listBaselines,
        update: verb('update')
    };
}
