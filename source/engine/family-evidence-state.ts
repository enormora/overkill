import type { AnalysisEvent } from './family-evidence-schema.ts';
import { caseIdentityKey, workIdentityKey } from './identity.ts';
import { artifactReferenceKey, artifactsForAttempt } from './run-artifact.ts';
import { singleAttemptResult, type PerTestResult, type RunArtifact } from './run-result.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

type CaseEvent = Extract<AnalysisEvent, { readonly kind: 'case-end' | 'case-progress' | 'case-start'; }>;
type EvidenceState = 'active' | 'completed' | 'pending';
type AnalysisCompletion = {
    readonly result: PerTestResult;
    readonly artifacts: readonly RunArtifact[];
};

export type FamilyEvidenceState = {
    readonly caseFor: (event: CaseEvent) => TestPlanCase;
    readonly recordArtifacts: (incoming: readonly RunArtifact[]) => void;
    readonly start: (testCase: TestPlanCase) => void;
    readonly finish: (
        testCase: TestPlanCase,
        event: Extract<CaseEvent, { readonly kind: 'case-end'; }>
    ) => AnalysisCompletion;
    readonly results: (skipped: ReadonlyMap<string, PerTestResult>) => readonly PerTestResult[];
    readonly artifacts: () => readonly RunArtifact[];
};

function artifactWorkKey(artifact: RunArtifact): string | null {
    const { scope, runtimes, workload, familyVariant } = artifact.id;
    return scope.kind === 'run' ? null : workIdentityKey({ case: scope.case, runtimes, workload, familyVariant });
}

function activeArtifact(artifact: RunArtifact, states: ReadonlyMap<string, EvidenceState>): string | null {
    const workKey = artifactWorkKey(artifact);
    if (workKey !== null && (artifact.id.attempt?.index !== 0 || states.get(workKey) !== 'active')) {
        throw new TypeError('Analysis artifact does not belong to active selected work.');
    }
    return workKey;
}

type EvidenceArtifact = { readonly artifact: RunArtifact; readonly workKey: string | null; };
type ArtifactStore = {
    readonly record: (incoming: readonly RunArtifact[]) => void;
    readonly forWork: (key: string) => readonly RunArtifact[];
    readonly all: () => readonly RunArtifact[];
};

function createArtifactStore(states: ReadonlyMap<string, EvidenceState>): ArtifactStore {
    const artifacts = new Map<string, RunArtifact>();
    const byWork = new Map<string, RunArtifact[]>();

    function add(key: string, entry: EvidenceArtifact): void {
        artifacts.set(key, entry.artifact);
        if (entry.workKey !== null) {
            const previous = byWork.get(entry.workKey) ?? [];
            previous.push(entry.artifact);
            byWork.set(entry.workKey, previous);
        }
    }

    return {
        record(incoming: readonly RunArtifact[]): void {
            const accepted = new Map<string, EvidenceArtifact>();
            for (const artifact of incoming) {
                const workKey = activeArtifact(artifact, states);
                const key = artifactReferenceKey(artifact.id);
                if (artifacts.has(key) || accepted.has(key)) {
                    throw new TypeError('Duplicate analysis artifact.');
                }
                accepted.set(key, { artifact, workKey });
            }
            for (const [ key, entry ] of accepted) {
                add(key, entry);
            }
        },
        forWork(key: string): readonly RunArtifact[] {
            return byWork.get(key) ?? [];
        },
        all(): readonly RunArtifact[] {
            return Array.from(artifacts.values());
        }
    };
}

function completionResult(
    testCase: TestPlanCase,
    event: Extract<CaseEvent, { readonly kind: 'case-end'; }>
): PerTestResult {
    const attempt = { index: 0 };
    if (
        caseIdentityKey(event.result.id) !== caseIdentityKey(testCase.id) ||
        artifactsForAttempt(event.artifacts, testCase.workId, attempt).length !== event.artifacts.length
    ) {
        throw new TypeError('Analysis completion identity does not match the selected work.');
    }
    return singleAttemptResult({
        ...event.result,
        id: testCase.id,
        workId: testCase.workId,
        definitionLocations: testCase.definitionLocations
    }, attempt);
}

function eventWork(event: CaseEvent): TestPlanCase['workId'] {
    return (event.kind === 'case-end' ? event.result : event).workId;
}

export function createFamilyEvidenceState(testPlan: TestPlan): FamilyEvidenceState {
    const selected = new Map(testPlan.cases.map(function byIdentity(testCase) {
        return [ workIdentityKey(testCase.workId), testCase ] as const;
    }));
    const states = new Map<string, EvidenceState>();
    const completed = new Map<string, PerTestResult>();
    const artifactStore = createArtifactStore(states);
    return {
        caseFor(event) {
            const key = workIdentityKey(eventWork(event));
            const testCase = selected.get(key);
            const expected = event.kind === 'case-start' ? 'pending' : 'active';
            if (testCase?.execution.kind !== 'body' || (states.get(key) ?? 'pending') !== expected) {
                throw new TypeError('Analysis event is out of order or refers to unknown selected work.');
            }
            return testCase;
        },
        start(testCase) {
            states.set(workIdentityKey(testCase.workId), 'active');
        },
        finish(testCase, event) {
            const result = completionResult(testCase, event);
            artifactStore.record(event.artifacts);
            const key = workIdentityKey(testCase.workId);
            states.set(key, 'completed');
            completed.set(key, result);
            return { result, artifacts: artifactStore.forWork(key) };
        },
        recordArtifacts: artifactStore.record,
        artifacts: artifactStore.all,
        results(skipped) {
            return Array.from(selected.keys()).flatMap(function orderedResult(key) {
                const result = completed.get(key) ?? skipped.get(key);
                return result === undefined ? [] : [ result ];
            });
        }
    };
}

export function completeFamilyResults(plan: TestPlan, results: readonly PerTestResult[]): readonly PerTestResult[] {
    const completed = new Map(results.map(function byWork(result) {
        return [ workIdentityKey(result.workId), result ];
    }));
    return plan.cases.map(function complete(testCase) {
        const result = completed.get(workIdentityKey(testCase.workId));
        if (result !== undefined) {
            return result;
        }
        const outcome = testCase.execution.kind === 'skip'
            ? { kind: 'skip' as const, reason: testCase.execution.reason }
            : { kind: 'inconclusive' as const, reason: 'Family execution ended without complete evidence.' };
        return singleAttemptResult({
            id: testCase.id,
            workId: testCase.workId,
            definitionLocations: testCase.definitionLocations,
            outcome,
            verdict: outcome.kind,
            durationMicroseconds: 0
        }, { index: 0 });
    });
}
