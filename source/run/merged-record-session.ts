import { createClock } from '@enormora/clock';
import { createReporterDispatcher, type ReporterDelivery } from '../engine/reporter-dispatcher.ts';
import { createBriefFinalResultReporter } from '../packages/reporter-brief/reporter-brief.entry-point.ts';
import { createMergedRecordStorage } from './merged-record-storage.ts';
import { maintainHistory } from './history-maintenance.ts';
import type { MergeResultsCommand, MergedRunRecord } from './merge-results-types.ts';
import { formatRunnerErrorDiagnostics } from './command-line-command.ts';
import { RunCollectionError } from './run-errors.ts';

type MergedStorage = Awaited<ReturnType<typeof createMergedRecordStorage>>;
export type MergedRecordOutcome = {
    readonly record: MergedRunRecord;
    readonly diagnostics: readonly string[];
};
function mergeDispatcher(): ReturnType<typeof createReporterDispatcher> {
    return createReporterDispatcher({
        wallClock: createClock(),
        stdout: {
            writeLine(line) {
                process.stdout.write(`${line}\n`);
            }
        },
        stderr: {
            writeLine(line) {
                process.stderr.write(`${line}\n`);
            }
        }
    });
}
async function deliverResult(storage: MergedStorage, delivery: ReporterDelivery): Promise<void> {
    try {
        storage.retainErrors(await delivery.reportResult(storage.current().result));
    } finally {
        storage.retainErrors(await delivery.disposeReporters());
    }
}
async function completeMerge(
    command: MergeResultsCommand,
    storage: MergedStorage,
    dispatcher: ReturnType<typeof mergeDispatcher>
): Promise<MergedRunRecord> {
    await storage.persist('started');
    const profile = command.config.profiles[storage.current().facts.execution.profile];
    const delivery = await dispatcher.createFinalDelivery(
        profile?.reporters ?? command.config.reporters ?? [],
        command.config.outputRenderer,
        storage.current().facts,
        createBriefFinalResultReporter()
    );
    await deliverResult(storage, delivery);
    await storage.persist('completed');
    return storage.current();
}
async function runMerge(
    command: MergeResultsCommand,
    storage: MergedStorage,
    dispatcher: ReturnType<typeof mergeDispatcher>
): Promise<MergedRunRecord> {
    try {
        return await completeMerge(command, storage, dispatcher);
    } catch (error: unknown) {
        const failure = new RunCollectionError('Merged result delivery interrupted.', { cause: error }, 'reporter');
        storage.retainErrors([ failure.runnerError() ]);
        await storage.persist('interrupted');
        throw error;
    } finally {
        await storage.release();
    }
}
export async function executeMergedRecord(
    command: MergeResultsCommand,
    initial: MergedRunRecord
): Promise<MergedRecordOutcome> {
    const storage = await createMergedRecordStorage(command, initial);
    const dispatcher = mergeDispatcher();
    const tracked = await dispatcher.trackRunnerErrorDelivery(async function deliverMergedRecord() {
        return await runMerge(command, storage, dispatcher);
    });
    const maintenance = await maintainHistory({ projectRoot: command.cwd, config: command.config });
    return {
        record: tracked.result,
        diagnostics: [
            ...formatRunnerErrorDiagnostics(tracked.result.result.runnerErrors.filter(function undelivered(error) {
                return !tracked.deliveredRunnerErrors.includes(error);
            })),
            ...maintenance
        ]
    };
}
