import type { Clock } from '@enormora/clock';
import type { ReporterDispatcher, ReporterDelivery } from '../engine/reporter-dispatcher.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { BenchmarkProfileConfig } from '../config/types.ts';
import type { ComparableCalibration } from '../packages/run/benchmark-calibration.entry-point.ts';
import { createPerformanceWorkflow, type PerformanceWorkflow } from '../baselines/performance-workflow.ts';
import { finalizeBenchmarkBaselines } from './benchmark-baseline-finalization.ts';
import type { RunRequest } from './run-types.ts';

import type { RunResultSession } from './run-support.ts';

export type BenchmarkBaselineSession = RunResultSession;
type BenchmarkBaselineSessionInput = {
    readonly calibration: ComparableCalibration;
    readonly clock: Clock;
    readonly profile: BenchmarkProfileConfig;
    readonly projectRoot: string;
    readonly reporterDispatcher: ReporterDispatcher;
    readonly request: RunRequest;
};
type BaselineReporter = {
    readonly dispatcher: ReporterDispatcher;
    readonly notify: (errors: readonly RunnerError[]) => Promise<readonly RunnerError[]>;
};

function createBaselineReporter(dispatcher: ReporterDispatcher, workflow: PerformanceWorkflow): BaselineReporter {
    let delivery: ReporterDelivery | null = null;
    async function notify(errors: readonly RunnerError[]): Promise<readonly RunnerError[]> {
        if (delivery === null) {
            return [];
        }
        const reportingErrors: RunnerError[] = [];
        for (const error of errors) {
            reportingErrors.push(...await delivery.reportEvent({ error, kind: 'runner-error' }));
        }
        return reportingErrors;
    }
    return {
        notify,
        dispatcher: {
            trackRunnerErrorDelivery: dispatcher.trackRunnerErrorDelivery,
            async createDelivery(reporters, renderer) {
                delivery = await dispatcher.createDelivery(reporters, renderer);
                const underlying = delivery;
                return {
                    disposeReporters: underlying.disposeReporters,
                    reportResult: underlying.reportResult,
                    async reportEvent(event) {
                        if (event.kind !== 'test-end') {
                            return await underlying.reportEvent(event);
                        }
                        const evaluation = workflow.evaluate(event);
                        return [
                            ...evaluation.errors,
                            ...await notify(evaluation.errors),
                            ...await underlying.reportEvent(evaluation.event)
                        ];
                    }
                };
            }
        }
    };
}

export async function createBenchmarkBaselineSession(
    input: BenchmarkBaselineSessionInput
): Promise<BenchmarkBaselineSession> {
    const { calibration, profile, request } = input;
    const workflow = await createPerformanceWorkflow({
        adapters: profile.baselines.adapters,
        calibration,
        directory: profile.baselines.directory,
        maxBytes: profile.attachments.maxArtifactBytes,
        mode: request.baselineUpdateMode,
        profile: request.profile,
        projectRoot: input.projectRoot
    });
    const reporter = createBaselineReporter(input.reporterDispatcher, workflow);
    return {
        reporterDispatcher: reporter.dispatcher,
        async finalize(result) {
            return await finalizeBenchmarkBaselines({
                calibration,
                capturedAtMicroseconds() {
                    return Number(input.clock.currentMonotonicMicroseconds);
                },
                completeInventory: request.paths.length === 0 && request.selection.kind === 'all' &&
                    request.shard.total === 1,
                maxBytes: profile.attachments.maxArtifactBytes,
                mode: request.baselineUpdateMode,
                notify: reporter.notify,
                result,
                workflow
            });
        }
    };
}
