import type { CaseId } from '../engine/identity.ts';
import type { FailedCheck, SourceLocation } from '../engine/test-node.ts';
import type {
    OrphanedNode,
    RunnerError,
    RunResult,
    RunSummary,
    SuiteRunCounts,
    TestOutcome
} from '../engine/run-result.ts';

type FailedCheckOverrides = Partial<FailedCheck> & {
    readonly location?: Partial<SourceLocation>;
};

type FailOutcomeOverrides = {
    readonly checks?: readonly FailedCheckOverrides[];
    readonly kind: 'fail';
};

type InconclusiveOutcomeOverrides = {
    readonly kind: 'inconclusive';
    readonly reason?: string;
};

type PassOutcomeOverrides = {
    readonly kind?: 'pass';
};

type SkipOutcomeOverrides = {
    readonly kind: 'skip';
    readonly reason?: string;
};

type TestOutcomeOverrideByKind = {
    readonly fail: FailOutcomeOverrides;
    readonly inconclusive: InconclusiveOutcomeOverrides;
    readonly pass: PassOutcomeOverrides;
    readonly skip: SkipOutcomeOverrides;
};

type TestOutcomeOverrides = TestOutcomeOverrideByKind[keyof TestOutcomeOverrideByKind];

type PerTestResultOverrides = {
    readonly id?: CaseId;
    readonly outcome?: TestOutcomeOverrides;
    readonly verdict?: TestOutcome['kind'];
};

type OrphanedNodeOverrides = Partial<OrphanedNode>;

type RunnerErrorOverrides = Partial<RunnerError>;

type RunResultOverrides = {
    readonly artifacts?: readonly string[];
    readonly bySuite?: Readonly<Record<string, SuiteRunCounts>>;
    readonly orphans?: readonly OrphanedNodeOverrides[];
    readonly perTest?: readonly PerTestResultOverrides[];
    readonly runnerErrors?: readonly RunnerErrorOverrides[];
    readonly summary?: Partial<RunSummary>;
    readonly wallTimeMs?: number;
};

const defaultLocation: SourceLocation = {
    column: null,
    file: 'source/example.test.ts',
    line: null
};

const defaultSummary: RunSummary = {
    defined: 0,
    discovered: 0,
    failed: 0,
    inconclusive: 0,
    passed: 0,
    planned: 0,
    skipped: 0
};

const defaultCaseId: CaseId = {
    file: null,
    name: 'passes',
    params: null,
    suite: [ 'root' ]
};

const defaultFailedCheck: FailedCheck = {
    actual: null,
    expected: null,
    id: 'check',
    location: defaultLocation,
    path: [],
    summary: 'Check failed'
};

const emptyFailedCheckOverrides: readonly FailedCheckOverrides[] = [];
const emptyOrphanedNodeOverrides: readonly OrphanedNodeOverrides[] = [];
const emptyPerTestResultOverrides: readonly PerTestResultOverrides[] = [];
const emptyRunnerErrorOverrides: readonly RunnerErrorOverrides[] = [];

function buildFailedCheck(overrides: FailedCheckOverrides = {}): FailedCheck {
    return {
        ...defaultFailedCheck,
        ...overrides,
        location: {
            ...defaultLocation,
            ...overrides.location
        }
    };
}

function buildFailOutcome(overrides: FailOutcomeOverrides): TestOutcome {
    return {
        checks: (overrides.checks ?? emptyFailedCheckOverrides).map(buildFailedCheck),
        kind: 'fail'
    };
}

function buildInconclusiveOutcome(overrides: InconclusiveOutcomeOverrides): TestOutcome {
    return { kind: 'inconclusive', reason: overrides.reason ?? 'Inconclusive' };
}

function buildSkipOutcome(overrides: SkipOutcomeOverrides): TestOutcome {
    return { kind: 'skip', reason: overrides.reason ?? 'Skipped' };
}

function buildOutcome(overrides: TestOutcomeOverrides = {}): TestOutcome {
    if (overrides.kind === 'fail') {
        return buildFailOutcome(overrides);
    }

    if (overrides.kind === 'inconclusive') {
        return buildInconclusiveOutcome(overrides);
    }

    if (overrides.kind === 'skip') {
        return buildSkipOutcome(overrides);
    }

    return { kind: 'pass' };
}

function buildPerTestResult(overrides: PerTestResultOverrides = {}): RunResult['perTest'][number] {
    const outcome = buildOutcome(overrides.outcome);

    return {
        id: overrides.id ?? defaultCaseId,
        outcome,
        verdict: overrides.verdict ?? outcome.kind
    };
}

function buildOrphanedNode(overrides: OrphanedNodeOverrides = {}): OrphanedNode {
    return {
        file: overrides.file === undefined ? 'source/example.test.ts' : overrides.file,
        kind: overrides.kind ?? 'test',
        name: overrides.name ?? 'orphaned test'
    };
}

function buildRunnerError(overrides: RunnerErrorOverrides = {}): RunnerError {
    return {
        attributedTo: overrides.attributedTo ?? null,
        cause: overrides.cause ?? null,
        message: overrides.message ?? 'Runner error',
        subtype: overrides.subtype ?? 'crash'
    };
}

function buildOrphanedNodes(overrides: readonly OrphanedNodeOverrides[] | undefined): readonly OrphanedNode[] {
    return (overrides ?? emptyOrphanedNodeOverrides).map(buildOrphanedNode);
}

function buildPerTestResults(overrides: readonly PerTestResultOverrides[] | undefined): RunResult['perTest'] {
    return (overrides ?? emptyPerTestResultOverrides).map(buildPerTestResult);
}

function buildRunnerErrors(overrides: readonly RunnerErrorOverrides[] | undefined): readonly RunnerError[] {
    return (overrides ?? emptyRunnerErrorOverrides).map(buildRunnerError);
}

function buildSummary(overrides: Partial<RunSummary> | undefined): RunSummary {
    return {
        ...defaultSummary,
        ...overrides
    };
}

function buildRunResult(overrides: RunResultOverrides = {}): RunResult {
    return {
        artifacts: overrides.artifacts ?? [],
        bySuite: overrides.bySuite ?? {},
        orphans: buildOrphanedNodes(overrides.orphans),
        perTest: buildPerTestResults(overrides.perTest),
        runnerErrors: buildRunnerErrors(overrides.runnerErrors),
        summary: buildSummary(overrides.summary),
        wallTimeMs: overrides.wallTimeMs ?? 0
    };
}

export const runResultFactory = {
    build: buildRunResult
};
