import { readCalibrationReferenceReport } from '../bench/calibration-report.ts';
import { readPerformanceBaselineReport } from '../baselines/performance-report.ts';
import type { BenchmarkBaselineCommand, BenchmarkBaselineRunResult, RunCommand, RunOperations } from './run-types.ts';
import type { RunInvocationTimingOptions } from './run-timing-collection.ts';

type ExecutingBaselineVerb = 'apply' | 'bootstrap' | 'diff' | 'update';

type BenchmarkBaselineInvocation = {
    readonly command: BenchmarkBaselineCommand;
    readonly operations: Pick<RunOperations<RunCommand>, 'runWithReporterDelivery'>;
    readonly options: RunInvocationTimingOptions;
    readonly verb: ExecutingBaselineVerb;
};

function calibrationChanges(
    result: BenchmarkBaselineRunResult['result']
): BenchmarkBaselineRunResult['calibrationChanges'] {
    return readCalibrationReferenceReport(result)?.changes ?? [];
}
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
        calibrationChanges: calibrationChanges(delivery.result),
        writeOutcome: report?.writeOutcome ?? { kind: 'blocked' }
    };
}
