import {
    caseIdentityKey,
    createDefaultWorkId,
    workIdentityKey,
    type AttemptId,
    type CaseId,
    type WorkId
} from '../engine/identity.ts';
import type { PerTestResult, RunnerError, RunArtifact } from '../engine/run-result.ts';
import { caseAttemptHistory } from '../engine/test-attempt-history.ts';
import type { RetryArtifactPolicy } from '../config/execution.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import type { RunRequest } from './run-types.ts';
import { createSupervisedOutputCapture } from './supervised-output-capture.ts';
import { retainedRetryArtifacts } from './retry-artifact-retention.ts';

export type StoredRunValue<Value> = StoredValue<Value>;
export const createStoredRunValue: <Value>(value: Value) => StoredRunValue<Value> = createStoredValue;

const microsecondsPerMillisecond = 1000;

type ActiveCaseTiming = {
    readonly startedAtMicroseconds: number;
};

export function remainingHardTimeoutMilliseconds(
    activeCases: Iterable<ActiveCaseTiming>,
    nowMicroseconds: number,
    hardTimeoutMilliseconds: number
): number | null {
    const starts = Array.from(activeCases, function toStart(activeCase) {
        return activeCase.startedAtMicroseconds;
    });

    if (starts.length === 0) {
        return null;
    }

    const elapsedMicroseconds = nowMicroseconds - Math.min(...starts);

    return Math.max(
        0,
        hardTimeoutMilliseconds * microsecondsPerMillisecond - elapsedMicroseconds
    ) / microsecondsPerMillisecond;
}

export type SupervisedCase = {
    readonly capture: RunRequest['capture'] | null;
    readonly definitionLocations?: PerTestResult['definitionLocations'];
    readonly id: CaseId;
    readonly workId?: WorkId;
};

export type ActiveSupervisedCase = SupervisedCase & {
    readonly attempt: AttemptId;
    readonly startedAtMicroseconds: number;
};

type TimingWindow = {
    readonly endedAtMicroseconds: number;
    readonly startedAtMicroseconds: number;
};

export type SupervisedRunState = {
    readonly activeCases: ReadonlyMap<string, ActiveSupervisedCase>;
    readonly addActiveCase: (
        key: string,
        testCase: SupervisedCase,
        startedAtMicroseconds: number,
        attempt: AttemptId
    ) => void;
    readonly artifacts: () => readonly RunArtifact[];
    readonly caseArtifacts: (work: WorkId, attempt: AttemptId) => readonly RunArtifact[];
    readonly recordTestAttemptResult: (
        key: string,
        result: PerTestResult,
        completion: 'final' | 'retry',
        completedAtMicroseconds: number
    ) => void;
    readonly perTestResults: () => readonly PerTestResult[];
    readonly beginOutputDraining: () => void;
    readonly recordCapturedOutput: (
        stream: 'stderr' | 'stdout',
        chunk: Uint8Array,
        capturedAtMicroseconds: number
    ) => void;
    readonly recordPerTestResult: (
        key: string,
        result: PerTestResult,
        completedAtMicroseconds: number
    ) => void;
    readonly recordArtifact: (artifact: RunArtifact) => void;
    readonly recordRunnerError: (error: RunnerError) => void;
    readonly recordRunnerErrors: (errors: readonly RunnerError[]) => void;
    readonly recordRuntimePolicyViolation: (capability: string, message: string) => void;
    readonly recordTerminalActiveCases: (verdict: PerTestResult['verdict'], completedAtMicroseconds: number) => void;
    readonly removeActiveCase: (key: string) => void;
    readonly runnerErrors: () => readonly RunnerError[];
    readonly testExecutionWallTimeMicroseconds: () => number;
};

function terminalResult(
    testCase: ActiveSupervisedCase,
    verdict: PerTestResult['verdict'],
    completedAtMicroseconds: number
): PerTestResult {
    return {
        attempts: [ {
            attempt: testCase.attempt,
            durationMicroseconds: Math.max(0, completedAtMicroseconds - testCase.startedAtMicroseconds),
            outcome: null,
            verdict
        } ],
        retried: null,
        definitionLocations: testCase.definitionLocations ?? [ { kind: 'unknown' } ],
        id: testCase.id,
        outcome: null,
        verdict,
        workId: testCase.workId ?? createDefaultWorkId(testCase.id),
        durationMicroseconds: Math.max(0, completedAtMicroseconds - testCase.startedAtMicroseconds)
    };
}

function caseArtifact(work: WorkId, attempt: AttemptId, artifacts: readonly RunArtifact[]): readonly RunArtifact[] {
    const key = workIdentityKey(work);

    return artifacts.filter(function belongsToCase(artifact) {
        if (artifact.id.scope.kind !== 'case' || artifact.id.attempt?.index !== attempt.index) {
            return false;
        }
        return workIdentityKey({
            case: artifact.id.scope.case,
            runtimes: artifact.id.runtimes,
            workload: artifact.id.workload
        }) === key;
    });
}

function singleAttribution<Value>(values: readonly Value[]): Value | null {
    const [ value = null ] = values;

    return values.length === 1 ? value : null;
}

function runtimePolicyPhase(activeCaseCount: number): 'body' | 'out-of-test' {
    return activeCaseCount === 0 ? 'out-of-test' : 'body';
}

function createRuntimePolicyError(
    activeCases: ReadonlyMap<string, ActiveSupervisedCase>,
    capability: string,
    message: string
): RunnerError {
    const policyActiveCaseIds = Array.from(activeCases.values(), function toCaseId(testCase) {
        return testCase.id;
    });
    const policyActiveWorkIds = Array.from(activeCases.values(), function toWorkId(testCase) {
        return testCase.workId ?? createDefaultWorkId(testCase.id);
    });
    const phase = runtimePolicyPhase(policyActiveCaseIds.length);

    return {
        attributedToAttempt: singleAttribution(Array.from(activeCases.values(), function attempt(testCase) {
            return testCase.attempt;
        })),
        attributedTo: singleAttribution(policyActiveCaseIds),
        attributedToWork: singleAttribution(policyActiveWorkIds),
        cause: {
            activeCases: policyActiveCaseIds,
            activeWork: policyActiveWorkIds,
            capability,
            phase,
            strictness: 'observed'
        },
        diagnostics: [
            { label: 'capability', value: capability },
            { label: 'phase', value: phase },
            { label: 'strictness', value: 'observed' }
        ],
        message,
        subtype: 'runtime-policy'
    };
}

function processEnvironmentPolicyError(error: RunnerError): boolean {
    const { cause } = error;

    return error.subtype === 'runtime-policy' &&
        typeof cause === 'object' &&
        cause !== null &&
        Reflect.get(cause, 'capability') === 'process-env';
}

function processEnvironmentBoundary(error: RunnerError): string {
    if (error.attributedTo === null) {
        return 'out-of-test';
    }

    return caseIdentityKey(error.attributedTo);
}

function processEnvironmentPolicyKey(error: RunnerError): string | null {
    if (!processEnvironmentPolicyError(error)) {
        return null;
    }

    return `process-env:${processEnvironmentBoundary(error)}`;
}

function processEnvironmentPolicyKeys(errors: readonly RunnerError[]): ReadonlySet<string> {
    return new Set(errors.flatMap(function toPolicyKey(error) {
        const key = processEnvironmentPolicyKey(error);

        return key === null ? [] : [ key ];
    }));
}

export function deduplicatedRuntimePolicyErrors(errors: readonly RunnerError[]): readonly RunnerError[] {
    const processEnvironmentKeys = new Set<string>();

    return errors.filter(function notDuplicatedProcessEnvironmentError(error) {
        const key = processEnvironmentPolicyKey(error);

        if (key === null) {
            return true;
        }

        if (processEnvironmentKeys.has(key)) {
            return false;
        }

        processEnvironmentKeys.add(key);

        return true;
    });
}

export function deduplicatedChildRuntimePolicyErrors(
    childErrors: readonly RunnerError[],
    supervisorErrors: readonly RunnerError[]
): readonly RunnerError[] {
    const supervisorKeys = processEnvironmentPolicyKeys(supervisorErrors);

    return childErrors.filter(function notDuplicatedBySupervisor(error) {
        const key = processEnvironmentPolicyKey(error);

        return key === null || !supervisorKeys.has(key);
    });
}

export function createSupervisedRunState(artifactPolicy: RetryArtifactPolicy): SupervisedRunState {
    const cases = {
        active: new Map<string, ActiveSupervisedCase>(),
        interruptedByPolicy: new Map<string, ActiveSupervisedCase>(),
        outputDraining: new Map<string, ActiveSupervisedCase>(),
        terminalOutputDraining: false
    };
    const artifacts: RunArtifact[] = [];
    const outputCapture = createSupervisedOutputCapture();
    const perTest = new Map<string, PerTestResult>();
    const attemptResults = new Map<string, PerTestResult[]>();
    const runnerErrors: RunnerError[] = [];
    const timingWindows: TimingWindow[] = [];
    const recordTerminalActiveCases = function recordTerminalActiveCases(
        verdict: PerTestResult['verdict'],
        completedAtMicroseconds: number
    ): void {
        const interrupted = verdict === 'crashed'
            ? new Map([ ...cases.interruptedByPolicy, ...cases.active ])
            : cases.active;
        for (const [ key, testCase ] of interrupted) {
            const previous = attemptResults.get(key) ?? [];
            perTest.set(
                key,
                caseAttemptHistory(terminalResult(testCase, verdict, completedAtMicroseconds), [
                    ...previous,
                    terminalResult(testCase, verdict, completedAtMicroseconds)
                ])
            );
            timingWindows.push({
                endedAtMicroseconds: completedAtMicroseconds,
                startedAtMicroseconds: testCase.startedAtMicroseconds
            });
        }

        cases.active.clear();
        if (verdict === 'crashed') {
            cases.interruptedByPolicy.clear();
        }
    };

    function recordFinalCaseResult(
        key: string,
        result: PerTestResult,
        activeCase: ActiveSupervisedCase | undefined
    ): void {
        perTest.set(key, result);
        if (activeCase !== undefined) {
            cases.outputDraining.set(key, activeCase);
        }
    }

    return {
        activeCases: cases.active,
        addActiveCase(key, testCase, startedAtMicroseconds, attempt) {
            if (cases.active.size === 0) {
                cases.outputDraining.clear();
            }
            cases.active.set(key, { ...testCase, attempt, startedAtMicroseconds });
        },
        artifacts() {
            return artifacts;
        },
        caseArtifacts(work, attempt) {
            return caseArtifact(work, attempt, artifacts);
        },
        perTestResults() {
            const results = new Map(perTest);
            for (const [ key, attempts ] of attemptResults) {
                const last = attempts.at(-1);
                if (!results.has(key) && last !== undefined) {
                    results.set(key, caseAttemptHistory(last, attempts));
                }
            }
            return Array.from(results.values());
        },
        beginOutputDraining() {
            cases.terminalOutputDraining = true;
        },
        recordCapturedOutput(stream, chunk, capturedAtMicroseconds) {
            const captureWindow = cases.active.size === 0 && cases.terminalOutputDraining
                ? cases.outputDraining
                : cases.active;
            const activeWork = Array.from(captureWindow.values(), function capturedWork(testCase) {
                return { attempt: testCase.attempt, work: testCase.workId ?? createDefaultWorkId(testCase.id) };
            });
            artifacts.push(...outputCapture.record(activeWork, stream, chunk, capturedAtMicroseconds));
        },
        recordArtifact(artifact) {
            artifacts.push(artifact);
        },
        recordTestAttemptResult(key, result, completion, completedAtMicroseconds) {
            const previous = attemptResults.get(key) ?? [];
            const results = [ ...previous, result ];
            attemptResults.set(key, results);
            const retained = retainedRetryArtifacts(artifacts, [ caseAttemptHistory(result, results) ], artifactPolicy);
            artifacts.splice(0, artifacts.length, ...retained);
            const activeCase = cases.active.get(key);
            if (activeCase !== undefined) {
                timingWindows.push({
                    endedAtMicroseconds: completedAtMicroseconds,
                    startedAtMicroseconds: activeCase.startedAtMicroseconds
                });
            }
            if (completion === 'final') {
                recordFinalCaseResult(key, caseAttemptHistory(result, results), activeCase);
            }
        },
        recordPerTestResult(key, result, completedAtMicroseconds) {
            const activeCase = cases.active.get(key);

            if (activeCase !== undefined) {
                timingWindows.push({
                    endedAtMicroseconds: completedAtMicroseconds,
                    startedAtMicroseconds: activeCase.startedAtMicroseconds
                });
            }

            perTest.set(key, result);
        },
        recordRunnerError(error) {
            runnerErrors.push(error);
        },
        recordRunnerErrors(errors) {
            runnerErrors.push(...errors);
        },
        recordRuntimePolicyViolation(capability, message) {
            runnerErrors.push(createRuntimePolicyError(cases.active, capability, message));
            for (const [ key, active ] of cases.active) {
                cases.interruptedByPolicy.set(key, active);
            }
            recordTerminalActiveCases('runtime-policy', 0);
        },
        recordTerminalActiveCases,
        removeActiveCase(key) {
            cases.active.delete(key);
            cases.interruptedByPolicy.delete(key);
        },
        runnerErrors() {
            return runnerErrors;
        },
        testExecutionWallTimeMicroseconds() {
            if (timingWindows.length === 0) {
                return 0;
            }

            const latestEnd = Math.max(...timingWindows.map(function toEnd(window) {
                return window.endedAtMicroseconds;
            }));
            const earliestStart = Math.min(...timingWindows.map(function toStart(window) {
                return window.startedAtMicroseconds;
            }));

            return Math.max(0, latestEnd - earliestStart);
        }
    };
}
