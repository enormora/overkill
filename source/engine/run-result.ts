import type { FailedCheck, NonEmptyReadonlyArray } from '../assertion-protocol/types.ts';
import type { CaseId } from './identity.ts';

type RunnerErrorSubtypeByName = {
    readonly attributionDrift: 'attribution-drift';
    readonly crash: 'crash';
    readonly fixture: 'fixture';
    readonly loader: 'loader';
    readonly permission: 'permission';
    readonly reporter: 'reporter';
    readonly unhandledRejection: 'unhandled-rejection';
};

type RunnerErrorSubtype = RunnerErrorSubtypeByName[keyof RunnerErrorSubtypeByName];

export type PassOutcome = {
    readonly checks?: never;
    readonly kind: 'pass';
    readonly reason?: never;
};

export type AssertionTestFailure = {
    readonly checks: NonEmptyReadonlyArray<FailedCheck>;
    readonly kind: 'assertion';
};

export type BodyErrorTestFailure = {
    readonly error: {
        readonly message: string;
        readonly name: string;
        readonly stack: string | null;
        readonly thrown: unknown;
    };
    readonly kind: 'body-error';
};

export type TestContractFailureCode = 'dead-builder-assertion' | 'invalid-plan' | 'no-assertions' | 'plan-mismatch';

export type TestContractFailure = {
    readonly actual: unknown;
    readonly code: TestContractFailureCode;
    readonly expected: string;
    readonly kind: 'test-contract';
    readonly summary: string;
};

export type TestFailure = AssertionTestFailure | BodyErrorTestFailure | TestContractFailure;

export type FailOutcome = {
    readonly failures: NonEmptyReadonlyArray<TestFailure>;
    readonly kind: 'fail';
    readonly reason?: never;
};

export type SkipOutcome = {
    readonly checks?: never;
    readonly kind: 'skip';
    readonly reason: string;
};

export type InconclusiveOutcome = {
    readonly checks?: never;
    readonly kind: 'inconclusive';
    readonly reason: string;
};

export type TestOutcome = FailOutcome | InconclusiveOutcome | PassOutcome | SkipOutcome;

export type RunnerError = {
    readonly attributedTo: CaseId | null;
    readonly cause: unknown;
    readonly message: string;
    readonly subtype: RunnerErrorSubtype;
};

export type RunSummary = {
    readonly defined: number;
    readonly discovered: number;
    readonly failed: number;
    readonly inconclusive: number;
    readonly passed: number;
    readonly planned: number;
    readonly skipped: number;
};

export type PerTestResult = {
    readonly id: CaseId;
    readonly outcome: TestOutcome;
    readonly verdict: TestOutcome['kind'];
};

export type SuiteRunCounts = {
    readonly discovered: number;
    readonly executed: number;
    readonly planned: number;
};

export type OrphanedNode = {
    readonly file: string | null;
    readonly kind: 'suite' | 'table' | 'test';
    readonly name: string;
};

export type RunResult = {
    readonly artifacts: readonly string[];
    readonly bySuite: Readonly<Record<string, SuiteRunCounts>>;
    readonly orphans: readonly OrphanedNode[];
    readonly perTest: readonly PerTestResult[];
    readonly runnerErrors: readonly RunnerError[];
    readonly summary: RunSummary;
    readonly wallTimeMs: number;
};

export function verdictFromOutcome(outcome: TestOutcome): PerTestResult['verdict'] {
    return outcome.kind;
}
