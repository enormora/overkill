import { executeCollectedPlan } from './collected-run-execution.ts';
import type { CollectedInvocationPlan, CollectedRunContext } from './collected-run-planning.ts';
import type { RunResult } from './run-engine-primitives.ts';
import { finalizeResultWithDurationHistory } from './run-support.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';

export async function executeCollectedInvocation(
    context: CollectedRunContext,
    plan: CollectedInvocationPlan,
    timing: RunTimingMeasurement
): Promise<RunResult> {
    const { dependencies } = context;
    if (plan.resolved.request.coverage) {
        const { runRecordedCoverage } = await import('./recorded-coverage-run.ts');
        return await runRecordedCoverage({
            command: { ...context.command, request: plan.resolved.request },
            dependencies,
            async execute({ record, session }) {
                await record.recordFacts(plan.resolved.facts);
                return await executeCollectedPlan(
                    context,
                    plan,
                    timing,
                    {
                        record,
                        async finalizeResult(run, result) {
                            const covered = await session.finalize(result);
                            return await record.checkpointResult(
                                await finalizeResultWithDurationHistory(dependencies, run, covered, timing)
                            );
                        }
                    }
                );
            },
            input: { ...context.input, request: plan.resolved.request },
            timing
        });
    }
    const { executeRecordedRun } = await import('./recorded-run.ts');
    return await executeRecordedRun(
        context.command.cwd,
        {
            ...context.input,
            request: plan.resolved.request
        },
        dependencies,
        async function executeRecordedInvocation(record) {
            await record?.recordFacts(plan.resolved.facts);
            return await executeCollectedPlan(
                context,
                plan,
                timing,
                {
                    record,
                    async finalizeResult(run, result) {
                        const finalized = await finalizeResultWithDurationHistory(dependencies, run, result, timing);
                        return record === null ? finalized : await record.checkpointResult(finalized);
                    }
                }
            );
        }
    );
}
