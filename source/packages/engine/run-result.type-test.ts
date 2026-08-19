import { describe, expect, test } from 'tstyche';
import type {
    PerTestResult,
    ReporterEvent,
    ResourceUsageSnapshot,
    RunResourceUsage,
    RunResourceUsageTracker,
    RunResult,
    RunSummary,
    RunnerError
} from './engine.entry-point.ts';

type OutcomeKind = 'fail' | 'inconclusive' | 'pass' | 'skip';
type ExpectedRunnerErrorSubtypeByName = {
    readonly attributionDrift: 'attribution-drift';
    readonly crash: 'crash';
    readonly fixture: 'fixture';
    readonly loader: 'loader';
    readonly permission: 'permission';
    readonly reporter: 'reporter';
    readonly resourceExhaustion: 'resource-exhaustion';
    readonly unhandledRejection: 'unhandled-rejection';
};
type ExpectedRunnerErrorSubtype = ExpectedRunnerErrorSubtypeByName[keyof ExpectedRunnerErrorSubtypeByName];
type RunResultKeys = readonly [
    'artifacts',
    'bySuite',
    'orphans',
    'perTest',
    'resourceUsage',
    'runnerErrors',
    'summary',
    'wallTimeMs'
];
type ExpectedRunResultKey = RunResultKeys[number];
type RunSummaryKeys = readonly [
    'crashed',
    'defined',
    'discovered',
    'failed',
    'inconclusive',
    'passed',
    'planned',
    'resourceExhausted',
    'skipped'
];
type ExpectedRunSummaryKey = RunSummaryKeys[number];
type TestEndReporterEvent = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;

describe('run result verdicts', function () {
    test('per-test and reporter verdicts accept outcomes and terminal runner verdicts', function () {
        expect<PerTestResult['verdict']>().type.toBe<OutcomeKind | 'crashed' | 'resource-exhausted'>();
        expect<TestEndReporterEvent['verdict']>().type.toBe<OutcomeKind | 'crashed' | 'resource-exhausted'>();
    });
});

describe('RunSummary', function () {
    test('includes terminal runner verdict counts', function () {
        expect<keyof RunSummary>().type.toBe<ExpectedRunSummaryKey>();
    });
});

describe('RunResult', function () {
    test('includes resource usage as nullable measured data', function () {
        expect<keyof RunResult>().type.toBe<ExpectedRunResultKey>();
        expect<RunResult['resourceUsage']>().type.toBe<RunResourceUsage | null>();
        expect<RunResourceUsage['start']>().type.toBe<ResourceUsageSnapshot>();
        expect<RunResourceUsageTracker['finish']>().type.toBe<() => RunResourceUsage>();
    });
});

describe('RunnerError', function () {
    test('subtype is the documented union', function () {
        expect<RunnerError['subtype']>().type.toBe<ExpectedRunnerErrorSubtype>();
    });
});
