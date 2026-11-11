import pLimit from 'p-limit';
import { createFamilyEvidenceState, completeFamilyResults, type FamilyEvidenceState } from './family-evidence-state.ts';
import { familyEventSchema, type AnalysisEvent } from './family-evidence-schema.ts';
import { workIdentityKey } from './identity.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import { reportSuiteTransition } from './reporter-event-queue.ts';
import { reportRunnerErrors } from './runner-error-reporting.ts';
import { singleAttemptResult, type PerTestResult, type RunArtifact, type RunnerError } from './run-result.ts';
import type { FamilyAnalysisContext, FamilyEvent } from './test-family.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

type AnalysisEvidence = {
    readonly artifacts: readonly RunArtifact[];
    readonly perTest: readonly PerTestResult[];
    readonly reporterErrors: readonly RunnerError[];
};

function evidenceError(cause: unknown): RunnerError {
    return {
        attributedTo: null,
        attributedToAttempt: null,
        cause,
        diagnostics: [],
        message: cause instanceof Error ? cause.message : 'Analysis family execution failed.',
        subtype: 'runtime-state'
    };
}

type EvidenceDelivery = {
    readonly start: (testCase: TestPlanCase) => Promise<void>;
    readonly progress: (testCase: TestPlanCase, note: string) => Promise<void>;
    readonly end: (testCase: TestPlanCase, result: PerTestResult, artifacts: readonly RunArtifact[]) => Promise<void>;
    readonly error: (error: RunnerError) => Promise<void>;
    readonly finish: () => Promise<readonly RunnerError[]>;
};

function createEvidenceDelivery(reporter: ReporterDelivery): EvidenceDelivery {
    const errors: RunnerError[] = [];
    let suite: TestPlanCase['suitePath'] = [];
    async function transition(next: TestPlanCase['suitePath']): Promise<void> {
        const previous = suite;
        suite = next;
        errors.push(...await reportSuiteTransition(reporter, previous, next));
    }
    return {
        async start(testCase) {
            await transition(testCase.suitePath);
            errors.push(
                ...await reporter.reportEvent({
                    kind: 'test-start',
                    attempt: 0,
                    case: testCase.id,
                    workId: testCase.workId,
                    definitionLocations: testCase.definitionLocations,
                    suitePath: testCase.suitePath
                })
            );
        },
        async progress(testCase, note) {
            await transition(testCase.suitePath);
            errors.push(
                ...await reporter.reportEvent({
                    kind: 'test-progress',
                    attempt: 0,
                    case: testCase.id,
                    workId: testCase.workId,
                    definitionLocations: testCase.definitionLocations,
                    suitePath: testCase.suitePath,
                    note
                })
            );
        },
        async end(testCase, result, artifacts) {
            await transition(testCase.suitePath);
            errors.push(
                ...await reporter.reportEvent({
                    kind: 'test-end',
                    attempt: 0,
                    case: testCase.id,
                    workId: testCase.workId,
                    definitionLocations: testCase.definitionLocations,
                    suitePath: testCase.suitePath,
                    completion: 'final',
                    property: null,
                    benchmark: null,
                    artifacts,
                    outcome: result.outcome,
                    verdict: result.verdict,
                    durationMicroseconds: result.durationMicroseconds
                })
            );
        },
        async error(error) {
            errors.push(...await reportRunnerErrors(reporter, [ error ]));
        },
        async finish() {
            await transition([]);
            return errors;
        }
    };
}

async function acceptCase(
    event: Exclude<AnalysisEvent, { readonly kind: 'artifact' | 'run-error'; }>,
    state: FamilyEvidenceState,
    delivery: EvidenceDelivery
): Promise<void> {
    const testCase = state.caseFor(event);
    if (event.kind === 'case-start') {
        state.start(testCase);
        await delivery.start(testCase);
    } else if (event.kind === 'case-progress') {
        await delivery.progress(testCase, event.note);
    } else {
        const { result, artifacts } = state.finish(testCase, event);
        await delivery.end(testCase, result, artifacts);
    }
}

async function accept(event: AnalysisEvent, state: FamilyEvidenceState, delivery: EvidenceDelivery): Promise<void> {
    if (event.kind === 'artifact') {
        state.recordArtifacts([ event.artifact ]);
        return;
    }
    if (event.kind === 'run-error') {
        await delivery.error(event.error);
        return;
    }
    await acceptCase(event, state, delivery);
}

async function completeSkips(
    plan: TestPlan,
    delivery: EvidenceDelivery
): Promise<ReadonlyMap<string, PerTestResult>> {
    const results = new Map<string, PerTestResult>();
    const skips = plan.cases.filter(function authoredSkip(
        testCase
    ): testCase is TestPlanCase & { readonly execution: { readonly kind: 'skip'; readonly reason: string; }; } {
        return testCase.execution.kind === 'skip';
    });
    for (const testCase of skips) {
        const result = singleAttemptResult({
            id: testCase.id,
            workId: testCase.workId,
            definitionLocations: testCase.definitionLocations,
            outcome: { kind: 'skip', reason: testCase.execution.reason },
            verdict: 'skip',
            durationMicroseconds: 0
        }, { index: 0 });
        await delivery.start(testCase);
        await delivery.end(testCase, result, []);
        results.set(workIdentityKey(testCase.workId), result);
    }
    return results;
}

export async function executeFamilyAnalysis(
    testPlan: TestPlan,
    reporter: ReporterDelivery,
    execute: ((context: FamilyAnalysisContext) => Promise<void>) | null,
    signal: AbortSignal
): Promise<AnalysisEvidence> {
    const state = createFamilyEvidenceState(testPlan);
    const delivery = createEvidenceDelivery(reporter);
    const serial = pLimit(1);
    let accepting = true;
    async function report(event: FamilyEvent): Promise<void> {
        try {
            signal.throwIfAborted();
            await accept(familyEventSchema.parse(event), state, delivery);
        } catch (error: unknown) {
            await delivery.error(evidenceError(error));
        }
    }
    async function runBackend(): Promise<void> {
        if (execute !== null) {
            try {
                signal.throwIfAborted();
                await execute({
                    signal,
                    async report(event) {
                        if (!accepting) {
                            throw new TypeError('Family execution has already settled.');
                        }
                        await serial(report, event);
                    }
                });
                signal.throwIfAborted();
            } catch (error: unknown) {
                accepting = false;
                await serial(delivery.error, evidenceError(error));
            } finally {
                accepting = false;
            }
        }
        accepting = false;
        await serial(async function drainReports() {
            return undefined;
        });
    }
    await runBackend();
    async function finish(): Promise<AnalysisEvidence> {
        const skipped = await serial(completeSkips, testPlan, delivery);
        const results = state.results(skipped);
        if (results.length !== testPlan.cases.length) {
            await delivery.error(evidenceError(new Error('Family execution ended without complete evidence.')));
        }
        return {
            artifacts: state.artifacts(),
            perTest: completeFamilyResults(testPlan, results),
            reporterErrors: await delivery.finish()
        };
    }
    return await finish();
}
