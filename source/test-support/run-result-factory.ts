import { createFactory } from '@enormora/objectory';
import type { FailedCheck, SourceLocation } from '../engine/test-node.ts';
import type {
    OrphanedNode,
    PerTestResult,
    RunnerError,
    RunResult,
    RunSummary,
    TestOutcome
} from '../engine/run-result.ts';

type BuildableFailedCheck = {
    readonly actual: null;
    readonly expected: null;
    readonly id: FailedCheck['id'];
    readonly location: SourceLocation;
    readonly path: readonly string[];
    readonly summary: FailedCheck['summary'];
};

type BuildableTestOutcome = {
    readonly checks: readonly BuildableFailedCheck[];
    readonly kind: TestOutcome['kind'];
    readonly reason: TestOutcome['reason'];
};

type BuildablePerTestResult = {
    readonly id: PerTestResult['id'];
    readonly outcome: BuildableTestOutcome;
    readonly verdict: PerTestResult['verdict'];
};

type BuildableRunnerError = {
    readonly attributedTo: RunnerError['attributedTo'];
    readonly cause: null;
    readonly message: RunnerError['message'];
    readonly subtype: RunnerError['subtype'];
};

type BuildableRunResult = {
    readonly artifacts: RunResult['artifacts'];
    readonly bySuite: Readonly<Record<string, never>>;
    readonly orphans: RunResult['orphans'];
    readonly perTest: readonly BuildablePerTestResult[];
    readonly runnerErrors: readonly BuildableRunnerError[];
    readonly summary: RunResult['summary'];
    readonly wallTimeMs: RunResult['wallTimeMs'];
};

const sourceLocationFactory = createFactory<SourceLocation>(function createSourceLocation() {
    return {
        column: null,
        file: 'source/example.test.ts',
        line: null
    };
});

const failedCheckFactory = createFactory<BuildableFailedCheck>(function createFailedCheck() {
    return {
        actual: null,
        expected: null,
        id: 'check',
        location: sourceLocationFactory,
        path: [] as readonly string[],
        summary: 'Check failed'
    };
});

const testOutcomeFactory = createFactory<BuildableTestOutcome>(function createTestOutcome() {
    return {
        checks: failedCheckFactory.asArray({ length: 0 }),
        kind: 'pass',
        reason: null
    };
});

const perTestResultFactory = createFactory<BuildablePerTestResult>(function createPerTestResult() {
    return {
        id: 'root > passes',
        outcome: testOutcomeFactory,
        verdict: 'pass'
    };
});

const orphanedNodeFactory = createFactory<OrphanedNode>(function createOrphanedNode() {
    return {
        file: 'source/example.test.ts',
        kind: 'test',
        name: 'orphaned test'
    };
});

const runnerErrorFactory = createFactory<BuildableRunnerError>(function createRunnerError() {
    return {
        attributedTo: null,
        cause: null,
        message: 'Runner error',
        subtype: 'error'
    };
});

const runSummaryFactory = createFactory<RunSummary>(function createRunSummary() {
    return {
        defined: 0,
        discovered: 0,
        failed: 0,
        inconclusive: 0,
        passed: 0,
        skipped: 0
    };
});

const bySuiteFactory = createFactory<Readonly<Record<string, never>>>(function createBySuite() {
    return {};
});

export const runResultFactory = createFactory<BuildableRunResult>(function createRunResult() {
    return {
        artifacts: [] as readonly string[],
        bySuite: bySuiteFactory,
        orphans: orphanedNodeFactory.asArray({ length: 0 }),
        perTest: perTestResultFactory.asArray({ length: 0 }),
        runnerErrors: runnerErrorFactory.asArray({ length: 0 }),
        summary: runSummaryFactory,
        wallTimeMs: 0
    };
});
