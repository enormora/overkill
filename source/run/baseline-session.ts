import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { ReporterDelivery } from '../engine/reporter-dispatcher.ts';
import type { RunResult, RunnerError } from '../engine/run-result.ts';
import type { BaselineWriteOutcome, BaselineUpdateMode } from '../baselines/baseline-model.ts';
import { baselineRunnerError, successfulBaselineRun } from './baseline-outcomes.ts';
import { ordinaryBaselineReportArtifact, type OrdinaryBaselineReport } from './baseline-report.ts';
import type { StoredOrdinaryBaseline } from './baseline-record.ts';
import type { OrdinaryBaselineWorkflow } from './baseline-workflow.ts';
import type { RunResultSession } from './run-support.ts';

type SessionInput = {
    readonly workflow: OrdinaryBaselineWorkflow;
    readonly dispatcher: RunResultSession['reporterDispatcher'];
    readonly maxBytes: number;
    readonly mode: BaselineUpdateMode;
};
type WriteOutcome = BaselineWriteOutcome<StoredOrdinaryBaseline>;
type BaselineCommit = { readonly outcome: WriteOutcome; readonly errors: readonly RunnerError[]; };
type NotifyErrors = (errors: readonly RunnerError[]) => Promise<readonly RunnerError[]>;
function baselineReport(input: SessionInput, outcome: WriteOutcome): OrdinaryBaselineReport {
    return { version: 1, changes: input.workflow.changes, warnings: input.workflow.warnings, writeOutcome: outcome };
}
async function validateAndPublish(input: SessionInput, result: RunResult): Promise<BaselineCommit> {
    ordinaryBaselineReportArtifact(
        result,
        baselineReport(input, { kind: 'failed', writtenChanges: input.workflow.changes }),
        input.maxBytes
    );
    ordinaryBaselineReportArtifact(
        result,
        baselineReport(input, { kind: 'written', changes: input.workflow.changes }),
        input.maxBytes
    );
    if (input.mode === 'none' || input.mode === 'diff') {
        await input.workflow.store.validate(input.workflow.changes);
        return { outcome: { kind: 'read-only' }, errors: [] };
    }
    if (!successfulBaselineRun(result)) {
        return { outcome: { kind: 'blocked' }, errors: [] };
    }
    const committed = await input.workflow.store.publish(input.workflow.changes);
    return {
        outcome: committed.outcome,
        errors: committed.errors.map(function artifactError(error) {
            return baselineRunnerError(error, null);
        })
    };
}
async function commitBaselines(input: SessionInput, result: RunResult): Promise<BaselineCommit> {
    try {
        return await validateAndPublish(input, result);
    } catch (error: unknown) {
        return { outcome: { kind: 'blocked' }, errors: [ baselineRunnerError(error, null) ] };
    }
}
async function retainReport(
    input: SessionInput,
    result: RunResult,
    outcome: WriteOutcome,
    notify: NotifyErrors
): Promise<RunResult> {
    try {
        const artifact = ordinaryBaselineReportArtifact(result, baselineReport(input, outcome), input.maxBytes);
        return { ...result, artifacts: [ ...result.artifacts, artifact ] };
    } catch (error: unknown) {
        const failure = baselineRunnerError(error, null);
        return appendRunnerErrors(result, [ failure, ...await notify([ failure ]) ]);
    }
}
export function createOrdinaryBaselineSession(input: SessionInput): RunResultSession {
    const { workflow } = input;
    let delivery: ReporterDelivery | null = null;
    const inventoryErrors = new Set<RunnerError>();
    function prepareResult(result: RunResult): RunResult {
        const prepared = workflow.prepareResult(result);
        for (const error of prepared.runnerErrors.slice(result.runnerErrors.length)) {
            inventoryErrors.add(error);
        }
        return prepared;
    }
    async function notify(errors: readonly RunnerError[]): Promise<readonly RunnerError[]> {
        const reporting: RunnerError[] = [];
        for (const error of errors) {
            if (delivery !== null) {
                reporting.push(...await delivery.reportEvent({ kind: 'runner-error', error }));
            }
        }
        return reporting;
    }
    return {
        prepareResult,
        reporterDispatcher: {
            trackRunnerErrorDelivery: input.dispatcher.trackRunnerErrorDelivery,
            async createDelivery(reporters, renderer) {
                const underlying = await input.dispatcher.createDelivery(reporters, renderer);
                delivery = underlying;
                return {
                    disposeReporters: underlying.disposeReporters,
                    reportResult: underlying.reportResult,
                    async reportEvent(event) {
                        if (event.kind !== 'test-end') {
                            return await underlying.reportEvent(event);
                        }
                        const evaluated = await workflow.evaluate(event);
                        return [
                            ...evaluated.errors,
                            ...await notify(evaluated.errors),
                            ...await underlying.reportEvent(evaluated.event)
                        ];
                    }
                };
            }
        },
        async finalize(original) {
            const inventory = workflow.finish(prepareResult(original));
            const errors = new Set([
                ...inventoryErrors,
                ...inventory.runnerErrors.slice(original.runnerErrors.length)
            ]);
            const prepared = appendRunnerErrors(inventory, await notify(Array.from(errors)));
            const committed = await commitBaselines(input, prepared);
            const result = appendRunnerErrors(prepared, [ ...committed.errors, ...await notify(committed.errors) ]);
            return await retainReport(input, result, committed.outcome, notify);
        }
    };
}
