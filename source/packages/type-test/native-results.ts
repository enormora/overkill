import {
    createRunResult,
    workIdentityKey,
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
import type { OriginalAssertionPlan, NativeSite } from './original-assertions.ts';

export type SiteEvidence = {
    readonly site: NativeSite;
    readonly compilerVersion: string;
    readonly actual: string;
    readonly expected: string;
    readonly result: RelationEvidence;
};

function failedCheck(evidence: SiteEvidence, index: number): FailedCheck {
    const { relation, negated } = evidence.site.reference;
    const name = negated ? `${relation}.not` : relation;
    const message = `Type relation ${name} does not hold (TypeScript ${evidence.compilerVersion}).`;
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
        error: { name: 'TypeAssertionError', message, stack: null, thrown: name }
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
    issue: string | undefined
): TestOutcome {
    const outcome = assertionOutcome(results);
    if (outcome.kind === 'fail') {
        return outcome;
    }
    if (results.length < sites.length) {
        return { kind: 'inconclusive', reason: 'Missing compiler assertion evidence.' };
    }
    if (issue !== undefined) {
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
    evidence: ReadonlyMap<NativeSite, SiteEvidence>,
    issue: string | undefined
): TestOutcome {
    if (testCase.execution.kind === 'skip') {
        return { kind: 'skip', reason: testCase.execution.reason };
    }
    if (sites.length === 0) {
        return issue === undefined ? noAssertions() : { kind: 'inconclusive', reason: issue };
    }
    const results = sites.flatMap(function checkedSite(site) {
        const checked = evidence.get(site);
        return checked === undefined ? [] : [ checked ];
    });
    return evidenceOutcome(sites, results, issue);
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
function checkerErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Type-test checker failed.';
}

function sitesByOwner(assertionPlan: OriginalAssertionPlan): ReadonlyMap<string, readonly NativeSite[]> {
    const sites = new Map<string, NativeSite[]>();
    for (const site of assertionPlan.sites) {
        for (const owner of site.owners) {
            const key = workIdentityKey(owner);
            const owned = sites.get(key);
            if (owned === undefined) {
                sites.set(key, [ site ]);
            } else {
                owned.push(site);
            }
        }
    }
    return sites;
}

function caseResults(input: NativeCheckEvidence): readonly PerTestResult[] {
    const evidence = new Map((input.checked ?? []).map(function (entry) {
        return [ entry.site, entry ];
    }));
    const sites = sitesByOwner(input.assertionPlan);
    const issues = Map.groupBy(input.assertionPlan.issues, function owner(issue) {
        return workIdentityKey(issue.owner);
    });
    const failure = input.error === null ? null : checkerErrorMessage(input.error);
    return input.plan.cases.map(function caseResult(testCase) {
        const key = workIdentityKey(testCase.workId);
        const outcome = failure === null || testCase.execution.kind === 'skip'
            ? caseOutcome(testCase, sites.get(key) ?? [], evidence, issues.get(key)?.[0]?.reason)
            : { kind: 'inconclusive' as const, reason: failure };
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
    const message = checkerErrorMessage(input.error);
    const errors = Array.from(input.error === null ? [] : [ runError(message, input.error) ]);
    if (
        input.error === null && perTest.some(function missing(result) {
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
