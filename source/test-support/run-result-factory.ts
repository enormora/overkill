import type { CaseId } from '../engine/identity.ts';
import type {
    FailedCheck,
    NonEmptyReadonlyArray,
    SourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import type {
    OrphanedNode,
    RunnerError,
    RunResult,
    RunSummary,
    SuiteRunCounts,
    TestFailure,
    TestOutcome
} from '../engine/run-result.ts';

type FailedCheckOverrides = Partial<FailedCheck> & {
    readonly location?: Partial<SourceLocation>;
};

type AssertionTestFailureOverrides = {
    readonly checks?: readonly FailedCheckOverrides[];
    readonly kind?: 'assertion';
};

type BodyErrorTestFailureOverrides = {
    readonly error?: Extract<TestFailure, { readonly kind: 'body-error'; }>['error'];
    readonly kind: 'body-error';
};

type TestContractFailureOverrides = {
    readonly actual?: unknown;
    readonly code?: Extract<TestFailure, { readonly kind: 'test-contract'; }>['code'];
    readonly expected?: string;
    readonly kind: 'test-contract';
    readonly summary?: string;
};

type TestFailureOverrideByKind = {
    readonly assertion: AssertionTestFailureOverrides;
    readonly bodyError: BodyErrorTestFailureOverrides;
    readonly testContract: TestContractFailureOverrides;
};

type TestFailureOverrides = TestFailureOverrideByKind[keyof TestFailureOverrideByKind];

type FailOutcomeOverrides = {
    readonly checks?: readonly FailedCheckOverrides[];
    readonly failures?: readonly TestFailureOverrides[];
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
    source: 'assert',
    summary: 'Check failed'
};

const defaultTestFailure: TestFailure = {
    checks: [ defaultFailedCheck ],
    kind: 'assertion'
};

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

function buildFailedChecks(overrides: readonly FailedCheckOverrides[] | undefined): NonEmptyReadonlyArray<FailedCheck> {
    const checks = (overrides ?? [ defaultFailedCheck ]).map(buildFailedCheck);

    if (checks.length === 0) {
        return [ defaultFailedCheck ];
    }

    const first = checks[0];

    if (first === undefined) {
        return [ defaultFailedCheck ];
    }

    return [ first, ...checks.slice(1) ];
}

function buildAssertionTestFailure(overrides: AssertionTestFailureOverrides): TestFailure {
    return {
        checks: buildFailedChecks(overrides.checks),
        kind: 'assertion'
    };
}

function buildBodyErrorTestFailure(overrides: BodyErrorTestFailureOverrides): TestFailure {
    return {
        error: overrides.error ?? {
            message: 'Body error',
            name: 'Error',
            stack: null,
            thrown: new Error('Body error')
        },
        kind: 'body-error'
    };
}

function buildTestContractFailure(overrides: TestContractFailureOverrides): TestFailure {
    return {
        actual: overrides.actual ?? 0,
        code: overrides.code ?? 'no-assertions',
        expected: overrides.expected ?? 'at least one assertion',
        kind: 'test-contract',
        summary: overrides.summary ?? 'Expected at least one assertion.'
    };
}

function buildTestFailure(overrides: TestFailureOverrides = {}): TestFailure {
    if (overrides.kind === 'body-error') {
        return buildBodyErrorTestFailure(overrides);
    }

    if (overrides.kind === 'test-contract') {
        return buildTestContractFailure(overrides);
    }

    return buildAssertionTestFailure(overrides);
}

function buildTestFailures(overrides: readonly TestFailureOverrides[]): NonEmptyReadonlyArray<TestFailure> {
    const failures = overrides.map(buildTestFailure);

    if (failures.length === 0) {
        return [ defaultTestFailure ];
    }

    const first = failures[0];

    if (first === undefined) {
        return [ defaultTestFailure ];
    }

    return [ first, ...failures.slice(1) ];
}

function buildFailOutcome(overrides: FailOutcomeOverrides): TestOutcome {
    if (overrides.failures !== undefined) {
        return {
            failures: buildTestFailures(overrides.failures),
            kind: 'fail'
        };
    }

    const assertionFailureOverrides = overrides.checks === undefined ? {} : { checks: overrides.checks };

    return {
        failures: [ buildAssertionTestFailure(assertionFailureOverrides) ],
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
