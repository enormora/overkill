import type { Except } from 'type-fest';
import type { RunResult } from '../engine/run-result.ts';
import type { ReportingContext } from '../engine/reporting-context.ts';
import { formatFailure } from './line-failure-rendering.ts';

type LegacyRunResult = Except<RunResult, 'resourceChecks'>;

function hasResourceCheckCollection(result: LegacyRunResult | RunResult): result is RunResult {
    return Object.hasOwn(result, 'resourceChecks');
}

export function reportedResourceChecks(result: LegacyRunResult | RunResult): RunResult['resourceChecks'] {
    return hasResourceCheckCollection(result) ? result.resourceChecks : [];
}

export function lifetimeResourceCheckLines(result: RunResult, context: ReportingContext): readonly string[] {
    return reportedResourceChecks(result)
        .filter(function lifetime(snapshot) {
            return snapshot.interval.kind === 'lifetime';
        })
        .flatMap(function renderLifetime(snapshot) {
            return snapshot.failures.flatMap(function renderFinding(finding) {
                const target = finding.target === null ? '' : ` (${finding.target})`;
                return [
                    `${snapshot.resource}${target}`,
                    ...formatFailure({ kind: 'assertion', checks: [ finding.check ] }, context)
                ];
            });
        });
}
