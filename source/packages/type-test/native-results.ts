import type { ReadonlyDeep } from 'type-fest';
import type { Event as CheckerEvent } from 'tstyche/api';
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
import type { CheckerRun } from './checker.entry-point.ts';
import { caseKey, type NativeTranslation, type NativeSite } from './native-translation.ts';
import { checkerDiagnostic, checkerDiagnosticText, type CheckerDiagnostic } from './checker-diagnostics.ts';

type AssertionEventName = 'expect:error' | 'expect:fail' | 'expect:pass';
type AssertionEvent = ReadonlyDeep<Extract<CheckerEvent, [AssertionEventName, unknown]>>;
const assertionEventNames: ReadonlySet<string> = new Set([ 'expect:pass', 'expect:fail', 'expect:error' ]);
type CompilationEventName = 'collect:error' | 'directive:error' | 'file:error';
type CompilationEvent = ReadonlyDeep<Extract<CheckerEvent, [CompilationEventName, unknown]>>;
const compilationEventNames: ReadonlySet<string> = new Set([ 'file:error', 'collect:error', 'directive:error' ]);
type SiteEvidence = {
    readonly site: NativeSite;
    readonly passed: boolean;
    readonly diagnostics: readonly CheckerDiagnostic[];
};

function isAssertionEvent(event: ReadonlyDeep<CheckerEvent>): event is AssertionEvent {
    return assertionEventNames.has(event[0]);
}
function isCompilationEvent(event: ReadonlyDeep<CheckerEvent>): event is CompilationEvent {
    return compilationEventNames.has(event[0]);
}

function resultSite(check: CheckerRun, translation: NativeTranslation, event: AssertionEvent): NativeSite | null {
    const { node } = event[1].result.expect;
    const source = node.getSourceFile();
    const ranges = check.inputs.mapRange(source.fileName, { start: node.getStart(source), end: node.end }, 'generated');
    const module = check.inputs.modules.find(function generated(entry) {
        return entry.kind === 'ready' && entry.path === source.fileName;
    });
    if (module?.kind !== 'ready') {
        return null;
    }
    return translation.sites.find(function original(site) {
        return site.path === module.provenance.originalPath && ranges.some(function overlaps(range) {
            return range.start < site.range.end && site.range.start < range.end;
        });
    }) ?? null;
}

type EvidenceContext = { readonly check: CheckerRun; readonly translation: NativeTranslation; };

function mergeEvidence(
    context: EvidenceContext,
    site: NativeSite,
    event: AssertionEvent,
    previous: SiteEvidence | undefined
): SiteEvidence {
    const diagnostics = event[0] === 'expect:pass' ? [] : event[1].diagnostics.map(function diagnostic(value) {
        return checkerDiagnostic(context, value);
    });
    return {
        site,
        passed: event[0] === 'expect:pass' && previous?.passed !== false,
        diagnostics: [ ...previous?.diagnostics ?? [], ...diagnostics ]
    };
}

function siteEvidence(check: CheckerRun, translation: NativeTranslation): readonly SiteEvidence[] {
    const evidence = new Map<NativeSite, SiteEvidence>();
    const events = check.events.filter(isAssertionEvent);
    for (const event of events) {
        const site = resultSite(check, translation, event);
        if (site !== null) {
            evidence.set(site, mergeEvidence({ check, translation }, site, event, evidence.get(site)));
        }
    }
    return Array.from(evidence.values());
}

function failedCheck(evidence: SiteEvidence, index: number): FailedCheck {
    const detail = evidence.diagnostics.map(checkerDiagnosticText).join('\n');
    const message = detail.length === 0 ? 'TSTyche assertion failed.' : detail;
    return {
        kind: 'foreign',
        id: String(index + 1),
        label: 'TSTyche',
        source: 'assert',
        sourceLocations: [ {
            kind: 'known',
            file: evidence.site.path,
            line: evidence.site.line,
            column: evidence.site.column
        } ],
        summary: evidence.site.message ?? message,
        actual: serializeValue(evidence.diagnostics),
        expected: serializeValue('Passing type assertion'),
        diff: null,
        path: [],
        error: { name: 'TypeAssertionError', message, stack: null, thrown: evidence.diagnostics }
    };
}

function assertionOutcome(results: readonly SiteEvidence[]): TestOutcome {
    const failures = results
        .filter(function failed(entry) {
            return !entry.passed;
        })
        .map(failedCheck);
    const first = failures[0];
    return first === undefined ? { kind: 'pass' } : {
        kind: 'fail',
        failures: [ { kind: 'assertion', checks: [ first, ...failures.slice(1) ] } ]
    };
}

function caseOutcome(
    testCase: TestPlan['cases'][number],
    sites: readonly NativeSite[],
    evidence: readonly SiteEvidence[]
): TestOutcome {
    if (testCase.execution.kind === 'skip') {
        return { kind: 'skip', reason: testCase.execution.reason };
    }
    const owned = sites.filter(function owner(site) {
        return site.owners.includes(caseKey(testCase));
    });
    if (owned.length === 0) {
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
    const results = evidence.filter(function owner(entry) {
        return entry.site.owners.includes(caseKey(testCase));
    });
    if (
        owned.some(function missing(site) {
            return results.every(function matching(entry) {
                return entry.site !== site;
            });
        })
    ) {
        return { kind: 'inconclusive', reason: 'Missing checker assertion evidence.' };
    }
    return assertionOutcome(results);
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

function compilationErrors(check: CheckerRun | null, translation: NativeTranslation): readonly RunnerError[] {
    return check?.events.filter(isCompilationEvent).map(function compilationError(event) {
        const diagnostics = event[1].diagnostics.map(function diagnostic(value) {
            return checkerDiagnostic({ check, translation }, value);
        });
        return runError(diagnostics.map(checkerDiagnosticText).join('\n'), diagnostics);
    }) ?? [];
}

function checkerErrors(check: CheckerRun | null, translation: NativeTranslation): readonly RunnerError[] {
    if (check === null) {
        return [];
    }
    const errors = Array.from(compilationErrors(check, translation));
    const unowned = check.events.some(function missingOwner(event) {
        return isAssertionEvent(event) && resultSite(check, translation, event) === null;
    });
    if (unowned) {
        errors.push(runError('Checker reported an assertion without native source ownership.', null));
    }
    return errors;
}

type NativeCheckEvidence = {
    readonly plan: TestPlan;
    readonly translation: NativeTranslation;
    readonly checked: CheckerRun | null;
    readonly error: unknown;
    readonly started: number;
};
const microsecondsPerMillisecond = 1000;

function caseResults(input: NativeCheckEvidence): readonly PerTestResult[] {
    const evidence = input.checked === null ? [] : siteEvidence(input.checked, input.translation);
    return input.plan.cases.map(function caseResult(testCase) {
        const outcome = caseOutcome(testCase, input.translation.sites, evidence);
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
    const errors = [
        ...checkerErrors(input.checked, input.translation),
        ...input.error === null ? [] : [ runError(message, input.error) ]
    ];
    if (
        perTest.some(function missing(result) {
            return result.verdict === 'inconclusive';
        })
    ) {
        errors.push(runError('Type-test checks are inconclusive; assertion evidence is incomplete.', null));
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
