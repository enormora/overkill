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
import type { CallDiagnostic } from './call-diagnostics.ts';
import type { RelationEvidence } from './relation-evidence.ts';
import type { OriginalAssertionPlan, NativeSite } from './original-assertions.ts';

export type SiteEvidence = {
    readonly site: NativeSite;
    readonly compilerVersion: string;
    readonly actual: string;
    readonly expected: string;
    readonly result: RelationEvidence;
    readonly durationMicroseconds: number;
    readonly diagnostics: readonly CallDiagnostic[];
};

function operandPreview(operand: string): string {
    const singleLine = operand.replaceAll(/\s+/gu, ' ');
    const maximum = 96;
    return singleLine.length <= maximum ? singleLine : `${singleLine.slice(0, maximum)}…`;
}

function failedCheck(evidence: SiteEvidence, index: number): FailedCheck {
    const name = evidence.site.label;
    const message = evidence.site.reference.kind === 'call'
        ? `${name} expected ${evidence.expected}, observed ${evidence.actual}.`
        : `Type relation ${name} does not hold (TypeScript ${evidence.compilerVersion}).`;
    const label = evidence.site.reference.kind === 'call' ? name : `Type relation ${name}`;
    const preview = `${label} failed. Actual ${operandPreview(evidence.actual)}.` +
        ` Expected ${operandPreview(evidence.expected)}.`;
    const summary = evidence.site.message === null ? preview : `${evidence.site.message}. ${preview}`;
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
        summary,
        actual: serializeValue(evidence.actual),
        expected: serializeValue(evidence.expected),
        diff: null,
        path: [],
        error: {
            name: 'TypeAssertionError',
            message: `${message}\nActual: ${evidence.actual}\nExpected: ${evidence.expected}`,
            stack: null,
            thrown: name
        }
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

function inconclusiveAt(site: NativeSite, reason: string): TestOutcome {
    const { path, line, column } = site;
    return { kind: 'inconclusive', reason: `${path}:${line}:${column} ${reason}` };
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
        ? inconclusiveAt(uncertain.site, uncertain.result.reason)
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

function describeIssue(issue: OriginalAssertionPlan['issues'][number] | undefined): string | undefined {
    if (issue === undefined) {
        return undefined;
    }
    const { location, reason } = issue;
    return location.kind === 'known' ? `${location.file}:${location.line}:${location.column} ${reason}` : reason;
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
        const owned = sites.get(key) ?? [];
        const outcome = failure === null || testCase.execution.kind === 'skip'
            ? caseOutcome(testCase, owned, evidence, describeIssue(issues.get(key)?.[0]))
            : { kind: 'inconclusive' as const, reason: failure };
        const durationMicroseconds = owned.reduce(function addSiteDuration(total, site) {
            return total + (evidence.get(site)?.durationMicroseconds ?? 0) / site.owners.length;
        }, 0);
        const [ firstLocation, ...locations ] = testCase.definitionLocations;
        return singleAttemptResult({
            id: testCase.id,
            workId: testCase.workId,
            definitionLocations: [ resolveSourceLocation(firstLocation), ...locations.map(resolveSourceLocation) ],
            outcome,
            verdict: outcome.kind,
            durationMicroseconds
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
            return result.outcome?.kind === 'inconclusive' ? [ `${result.id.title}: ${result.outcome.reason}` ] : [];
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
