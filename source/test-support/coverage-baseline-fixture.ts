import { defineCompositeAssertion } from '@overkill-dev/test/assert';

import type { ReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RunResultSession } from '../run/run-support.ts';
import { withOrdinaryBaselineReport, readOrdinaryBaselineReport } from '../run/baseline-report.ts';

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
                const artifact = withOrdinaryBaselineReport(result, {
                    changes: [],
                    warnings,
                    writeOutcome: { kind: 'read-only' }
                }, reportByteLimit);
                return artifact;
            }
        }
        : null;
}
export const assertCoverageBaseline = defineCompositeAssertion({
    name: 'coverage baseline',
    assert(check, result: RunResult, enabled: boolean) {
        return check.group([
            check.deepEqual(readOrdinaryBaselineReport(result)?.warnings ?? [], enabled ? warnings : [])
        ]);
    }
});
