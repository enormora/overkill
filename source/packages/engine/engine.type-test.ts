import { describe, expect, test } from 'tstyche';
import type {
    FailedCheck,
    PerTestResult,
    ReporterEvent,
    RunnerError,
    TestOutcome
} from './engine.entry-point.ts';

type FailedCheckFixture = {
    readonly actual: 'actual';
    readonly expected: 'expected';
    readonly id: '1';
    readonly location: { readonly column: null; readonly file: ''; readonly line: null; };
    readonly path: readonly [];
    readonly summary: 'numbers differ';
};

type OutcomeKind = 'fail' | 'inconclusive' | 'pass' | 'skip';
type ExpectedRunnerErrorSubtypeByName = {
    readonly attributionDrift: 'attribution-drift';
    readonly crash: 'crash';
    readonly fixture: 'fixture';
    readonly loader: 'loader';
    readonly permission: 'permission';
    readonly reporter: 'reporter';
    readonly unhandledRejection: 'unhandled-rejection';
};
type ExpectedRunnerErrorSubtype = ExpectedRunnerErrorSubtypeByName[keyof ExpectedRunnerErrorSubtypeByName];

describe('TestOutcome', function () {
    test('accepts public outcome shapes', function () {
        expect<TestOutcome>().type.toBeAssignableFrom<{ readonly kind: 'pass'; }>();
        expect<TestOutcome>().type.toBeAssignableFrom<{
            readonly checks: readonly [FailedCheckFixture];
            readonly kind: 'fail';
        }>();
        expect<TestOutcome>().type.toBeAssignableFrom<{ readonly kind: 'skip'; readonly reason: 'filtered'; }>();
        expect<TestOutcome>().type.toBeAssignableFrom<{
            readonly kind: 'inconclusive';
            readonly reason: 'adapter lost result';
        }>();
    });

    test('rejects mixed public outcome shapes', function () {
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly checks: readonly [];
            readonly kind: 'pass';
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly kind: 'pass';
            readonly reason: null;
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly checks: readonly [FailedCheckFixture];
            readonly kind: 'skip';
            readonly reason: 'filtered';
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly checks: readonly [FailedCheckFixture];
            readonly kind: 'inconclusive';
            readonly reason: 'adapter lost result';
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{ readonly kind: 'fail'; }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly checks: readonly [FailedCheckFixture];
            readonly kind: 'fail';
            readonly reason: null;
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{ readonly kind: 'skip'; }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{ readonly kind: 'inconclusive'; }>();
    });

    test('keeps failed checks free of diff fields', function () {
        expect<keyof FailedCheck>().type.toBe<'actual' | 'expected' | 'id' | 'location' | 'path' | 'summary'>();
    });
});

describe('run result verdicts', function () {
    test('per-test and reporter verdicts accept only outcome kinds', function () {
        expect<PerTestResult['verdict']>().type.toBe<OutcomeKind>();
        expect<ReporterEvent['verdict']>().type.toBe<OutcomeKind | null>();
    });
});

describe('RunnerError', function () {
    test('subtype is the documented union', function () {
        expect<RunnerError['subtype']>().type.toBe<ExpectedRunnerErrorSubtype>();
    });
});
