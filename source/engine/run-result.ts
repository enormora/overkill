import type { FailedCheck } from './test-node.ts';

export type TestOutcome = {
    readonly checks: readonly FailedCheck[];
    readonly kind: 'fail' | 'inconclusive' | 'pass' | 'skip';
    readonly reason: string | null;
};

export type RunnerError = {
    readonly attributedTo: string | null;
    readonly cause: unknown;
    readonly message: string;
    readonly subtype: string;
};

export type RunSummary = {
    readonly defined: number;
    readonly discovered: number;
    readonly failed: number;
    readonly inconclusive: number;
    readonly passed: number;
    readonly skipped: number;
};

export type PerTestResult = {
    readonly id: string;
    readonly outcome: TestOutcome;
    readonly verdict: 'fail' | 'inconclusive' | 'pass' | 'skip';
};

export type SuiteRunCounts = {
    readonly discovered: number;
    readonly executed: number;
};

export type OrphanedNode = {
    readonly file: string;
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
