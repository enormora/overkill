import {
    createRunResult,
    singleAttemptResult,
    serializeValue,
    resolveSourceLocation,
    type TestPlan,
    type RunResult,
    type TestOutcome,
    type PerTestResult,
    type RunnerError,
    type FailedCheck
} from '../engine/engine.entry-point.ts';
import type { RelationEvidence } from './relation-evidence.ts';
import { caseKey, type OriginalAssertionPlan, type NativeSite } from './original-assertions.ts';

export type SiteEvidence = {
    readonly site: NativeSite;
    readonly compilerVersion: string;
    readonly actual: string;
    readonly expected: string;
    readonly result: RelationEvidence;
};

function failedCheck(evidence: SiteEvidence, index: number): FailedCheck {
    const message =
        `Type relation ${evidence.site.reference.relation} does not hold (TypeScript ${evidence.compilerVersion}).`;
    return {
        kind: 'foreign',
        id: String(index + 1),
        label: 'type-test',
        source: 'assert',
        sourceLocations: [ {
            kind: 'known',
            file: evidence.site.path,
            line: evidence.site.line,
            column: evidence.site.column
        } ],
        summary: evidence.site.message ?? message,
        actual: serializeValue(evidence.actual),
        expected: serializeValue(evidence.expected),
        diff: null,
        path: [],
        error: { name: 'TypeAssertionError', message, stack: null, thrown: evidence.site.reference.relation }
    };
}

function assertionOutcome(results: readonly SiteEvidence[]): TestOutcome {
    const failures = results
        .filter(function failed(entry) {
            return entry.result.kind === 'established' && !entry.result.holds;
        })
        .map(failedCheck);
    const first = failures[0];
    return first === undefined ? { kind: 'pass' } : {
        kind: 'fail',
        failures: [ { kind: 'assertion', checks: [ first, ...failures.slice(1) ] } ]
    };
}

function noAssertions(): TestOutcome {
    return {
        kind: 'fail',
        failures: [ {
            kind: 'test-contract',
            code: 'no-assertions',
            actual: 0,
            expected: 'at least one native assertion',
            summary: 'Selected type-test body has no native assertions.'
        } ]
    };
}

function evidenceOutcome(
    sites: readonly NativeSite[],
    results: readonly SiteEvidence[],
    issue: string | null
): TestOutcome {
    const outcome = assertionOutcome(results);
    if (outcome.kind === 'fail') {
        return outcome;
    }
    const missing = sites.some(function missingSite(site) {
        return results.every(function matching(entry) {
            return entry.site !== site;
        });
    });
    if (missing) {
        return { kind: 'inconclusive', reason: 'Missing compiler assertion evidence.' };
    }
    if (issue !== null) {
        return { kind: 'inconclusive', reason: issue };
    }
    const uncertain = results.find(function inconclusive(entry) {
        return entry.result.kind === 'inconclusive';
    });
    return uncertain?.result.kind === 'inconclusive'
        ? { kind: 'inconclusive', reason: uncertain.result.reason }
        : outcome;
}

function caseOutcome(
    testCase: TestPlan['cases'][number],
    sites: readonly NativeSite[],
    evidence: readonly SiteEvidence[],
    issues: OriginalAssertionPlan['issues']
): TestOutcome {
    if (testCase.execution.kind === 'skip') {
        return { kind: 'skip', reason: testCase.execution.reason };
    }
    const key = caseKey(testCase);
    const owned = sites.filter(function owner(site) {
        return site.owners.includes(key);
    });
    const issue = issues.find(function ownedIssue(entry) {
        return entry.owner === key;
    });
    if (owned.length === 0) {
        return issue === undefined ? noAssertions() : { kind: 'inconclusive', reason: issue.reason };
    }
    return evidenceOutcome(
        owned,
        evidence.filter(function owner(entry) {
            return entry.site.owners.includes(key);
        }),
        issue?.reason ?? null
    );
}

function runError(message: string, cause: unknown): RunnerError {
    return {
        subtype: 'loader',
        message,
        cause,
        attributedTo: null,
        attributedToAttempt: null,
        diagnostics: [ { label: 'type-test', value: message } ]
    };
}

export type NativeCheckEvidence = {
    readonly plan: TestPlan;
    readonly assertionPlan: OriginalAssertionPlan;
    readonly checked: readonly SiteEvidence[] | null;
    readonly error: unknown;
    readonly started: number;
};
const microsecondsPerMillisecond = 1000;
function caseResults(input: NativeCheckEvidence): readonly PerTestResult[] {
    const evidence = input.checked ?? [];
    return input.plan.cases.map(function caseResult(testCase) {
        const outcome = caseOutcome(testCase, input.assertionPlan.sites, evidence, input.assertionPlan.issues);
        const [ firstLocation, ...locations ] = testCase.definitionLocations;
        return singleAttemptResult({
            id: testCase.id,
            workId: testCase.workId,
            definitionLocations: [ resolveSourceLocation(firstLocation), ...locations.map(resolveSourceLocation) ],
            outcome,
            verdict: outcome.kind,
            durationMicroseconds: 0
        }, { index: 0 });
    });
}

export function nativeCheckResult(input: NativeCheckEvidence): RunResult {
    const perTest = caseResults(input);
    const message = input.error instanceof Error ? input.error.message : 'Checker setup failed.';
    const errors = Array.from(input.error === null ? [] : [ runError(message, input.error) ]);
    if (
        perTest.some(function missing(result) {
            return result.verdict === 'inconclusive';
        })
    ) {
        const reasons = perTest.flatMap(function inconclusive(result) {
            return result.outcome?.kind === 'inconclusive' ? [ result.outcome.reason ] : [];
        });
        errors.push(runError(`Type-test checks are inconclusive: ${reasons.join('; ')}`, null));
    }
    const started = input.started * microsecondsPerMillisecond;
    const completed = performance.now() * microsecondsPerMillisecond;
    return createRunResult(input.plan, perTest, errors, {
        startedAtMicroseconds: started,
        completedAtMicroseconds: completed,
        testExecutionWallTimeMicroseconds: completed - started,
        processUsage: null,
        planStatus: 'planned'
    });
}
