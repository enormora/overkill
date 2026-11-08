import type { TestScope } from '../packages/test/test.entry-point.ts';
import type { ReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RunResultSession } from '../run/run-support.ts';
import { ordinaryBaselineReportArtifact, readOrdinaryBaselineReport } from '../run/baseline-report.ts';

const warnings = [ 'Coverage baselines finalized.' ];
const reportByteLimit = 65_536;
export function coverageBaselineSession(
    enabled: boolean,
    reporterDispatcher: ReporterDispatcher
): RunResultSession | null {
    return enabled
        ? {
            reporterDispatcher,
            prepareResult(result) {
                return result;
            },
            async finalize(result) {
                const artifact = ordinaryBaselineReportArtifact(result, {
                    version: 1,
                    changes: [],
                    warnings,
                    writeOutcome: { kind: 'read-only' }
                }, reportByteLimit);
                return { ...result, artifacts: [ ...result.artifacts, artifact ] };
            }
        }
        : null;
}
export function assertCoverageBaseline(scope: TestScope, result: RunResult, enabled: boolean): void {
    scope.assert.deepEqual(readOrdinaryBaselineReport(result)?.warnings ?? [], enabled ? warnings : []);
}
