import { resolveSourceLocation } from '../assertion-protocol/source-location.ts';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { compareDeepValues } from '../compare/comparison.ts';
import type { ReporterEvent } from '../engine/reporter.ts';

export type BenchmarkCaseEnd = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;

type BaselineFailureInput = {
    readonly actual: unknown;
    readonly expected: unknown;
    readonly event: BenchmarkCaseEnd;
    readonly id: string;
    readonly summary: string;
};

export function failedPerformanceBaselineCheck(input: BaselineFailureInput): FailedCheck {
    const [ first, ...rest ] = input.event.definitionLocations;
    const comparison = compareDeepValues(input.actual, input.expected);
    return {
        actual: comparison.actual,
        diff: comparison.diff,
        expected: comparison.expected,
        id: input.id,
        kind: 'leaf',
        path: comparison.path,
        source: 'assert',
        sourceLocations: [ resolveSourceLocation(first), ...rest.map(resolveSourceLocation) ],
        summary: input.summary
    };
}
