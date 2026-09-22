import { caseIdentityKey, createDefaultWorkId, type CaseId, type WorkId } from '../engine/identity.ts';
import type { PerTestResult, RunArtifact, RunnerError } from '../engine/run-result.ts';
import type { RunRequest } from './run-types.ts';

export type SupervisedCase = {
    readonly capture: RunRequest['capture'] | null;
    readonly id: CaseId;
    readonly workId?: WorkId;
};

type ActiveSupervisedCase = SupervisedCase & {
    readonly startedAtMicroseconds: number;
};

type TimingWindow = {
    readonly endedAtMicroseconds: number;
    readonly startedAtMicroseconds: number;
};

export type StoredRunValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

export type SupervisedRunState = {
    readonly activeCases: ReadonlyMap<string, ActiveSupervisedCase>;
    readonly addActiveCase: (key: string, testCase: SupervisedCase, startedAtMicroseconds: number) => void;
    readonly artifacts: () => readonly RunArtifact[];
    readonly caseArtifacts: (testCase: CaseId) => readonly RunArtifact[];
    readonly perTestResults: () => readonly PerTestResult[];
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

type CapturedOutputByteSpan = {
    readonly byteLength: number;
    readonly truncated: boolean;
    readonly usedBytes: number;
};

export const capturedOutputLimitBytes = Number('1048576');
const runArtifactScopeKey = 'run';

function terminalResult(
    testCase: ActiveSupervisedCase,
    verdict: PerTestResult['verdict'],
    completedAtMicroseconds: number
): PerTestResult {
    return {
        id: testCase.id,
        outcome: null,
        verdict,
        workId: testCase.workId ?? createDefaultWorkId(testCase.id),
        durationMicroseconds: Math.max(0, completedAtMicroseconds - testCase.startedAtMicroseconds)
    };
}

function artifactScopeKey(artifact: RunArtifact): string {
    if (artifact.id.scope.kind === 'run') {
        return runArtifactScopeKey;
    }

    return caseIdentityKey(artifact.id.scope.case);
}

function caseArtifact(testCase: CaseId, artifacts: readonly RunArtifact[]): readonly RunArtifact[] {
    const key = caseIdentityKey(testCase);

    return artifacts.filter(function belongsToCase(artifact) {
        return artifact.id.scope.kind === 'case' && artifactScopeKey(artifact) === key;
    });
}

function capturedOutputScope(activeCaseIds: readonly CaseId[]): readonly RunArtifact['id']['scope'][] {
    if (activeCaseIds.length === 0) {
        return [ { kind: 'run' } ];
    }

    return activeCaseIds.map(function toCaseScope(testCase) {
        return {
            activeCases: activeCaseIds,
            case: testCase,
            confidence: activeCaseIds.length === 1 ? 'active-case' : 'concurrent-active',
            kind: 'case'
        };
    });
}

function capturedOutputBytes(
    scope: RunArtifact['id']['scope'],
    capturedOutputByteCount: ReadonlyMap<string, number>,
    chunk: Uint8Array
): CapturedOutputByteSpan {
    const key = scope.kind === 'run' ? runArtifactScopeKey : caseIdentityKey(scope.case);
    const usedBytes = capturedOutputByteCount.get(key) ?? 0;
    const availableBytes = Math.max(0, capturedOutputLimitBytes - usedBytes);
    const byteLength = Math.min(availableBytes, chunk.length);

    return {
        byteLength,
        truncated: byteLength < chunk.length,
        usedBytes
    };
}

function createRuntimePolicyError(
    activeCases: ReadonlyMap<string, SupervisedCase>,
    capability: string,
    message: string
): RunnerError {
    const policyActiveCaseIds = Array.from(activeCases.values(), function toCaseId(testCase) {
        return testCase.id;
    });
    const policyActiveWorkIds = Array.from(activeCases.values(), function toWorkId(testCase) {
        return testCase.workId ?? createDefaultWorkId(testCase.id);
    });
    const [ activeCase = null ] = policyActiveCaseIds;
    const [ activeWork = null ] = policyActiveWorkIds;

    return {
        attributedTo: policyActiveCaseIds.length === 1 ? activeCase : null,
        attributedToWork: policyActiveWorkIds.length === 1 ? activeWork : null,
        cause: {
            activeCases: policyActiveCaseIds,
            activeWork: policyActiveWorkIds,
            capability,
            phase: policyActiveCaseIds.length === 0 ? 'out-of-test' : 'body',
            strictness: 'observed'
        },
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

export function deduplicatedRuntimePolicyErrors(errors: readonly RunnerError[]): readonly RunnerError[] {
    const seenProcessEnvironmentKeys = new Set<string>();

    return errors.filter(function keepFirstProcessEnvironmentError(error) {
        const key = processEnvironmentPolicyKey(error);

        if (key === null) {
            return true;
        }

        if (seenProcessEnvironmentKeys.has(key)) {
            return false;
        }

        seenProcessEnvironmentKeys.add(key);

        return true;
    });
}

export function createStoredRunValue<Value>(initialValue: Value): StoredRunValue<Value> {
    let currentValue = initialValue;

    return {
        read() {
            return currentValue;
        },
        write(value) {
            currentValue = value;
        }
    };
}

export function createSupervisedRunState(): SupervisedRunState {
    const activeCases = new Map<string, ActiveSupervisedCase>();
    const artifacts: RunArtifact[] = [];
    const capturedOutputByteCounts = new Map<string, number>();
    const perTest = new Map<string, PerTestResult>();
    const runnerErrors: RunnerError[] = [];
    const timingWindows: TimingWindow[] = [];
    let artifactSequence = 0;
    const recordTerminalActiveCases = function recordTerminalActiveCases(
        verdict: PerTestResult['verdict'],
        completedAtMicroseconds: number
    ): void {
        for (const [ key, testCase ] of activeCases) {
            perTest.set(key, terminalResult(testCase, verdict, completedAtMicroseconds));
            timingWindows.push({
                endedAtMicroseconds: completedAtMicroseconds,
                startedAtMicroseconds: testCase.startedAtMicroseconds
            });
        }

        activeCases.clear();
    };

    return {
        activeCases,
        addActiveCase(key, testCase, startedAtMicroseconds) {
            activeCases.set(key, { ...testCase, startedAtMicroseconds });
        },
        artifacts() {
            return artifacts;
        },
        caseArtifacts(testCase) {
            return caseArtifact(testCase, artifacts);
        },
        perTestResults() {
            return Array.from(perTest.values());
        },
        recordCapturedOutput(stream, chunk, capturedAtMicroseconds) {
            const activeCaseIds = Array.from(activeCases.values(), function toCaseId(testCase) {
                return testCase.id;
            });
            const scopes = capturedOutputScope(activeCaseIds);

            for (const scope of scopes) {
                const key = scope.kind === 'run' ? runArtifactScopeKey : caseIdentityKey(scope.case);
                const captured = capturedOutputBytes(scope, capturedOutputByteCounts, chunk);

                capturedOutputByteCounts.set(key, captured.usedBytes + captured.byteLength);
                artifacts.push({
                    id: {
                        scope,
                        sequence: artifactSequence,
                        subtype: 'log-capture'
                    },
                    payload: {
                        byteLength: captured.byteLength,
                        capturedAtMicroseconds,
                        kind: 'captured-output',
                        stream,
                        text: Buffer.from(chunk.subarray(0, captured.byteLength)).toString('utf8'),
                        truncated: captured.truncated
                    },
                    source: 'boundary-captured'
                });
                artifactSequence += 1;
            }
        },
        recordArtifact(artifact) {
            artifacts.push(artifact);
        },
        recordPerTestResult(key, result, completedAtMicroseconds) {
            const activeCase = activeCases.get(key);

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
            runnerErrors.push(createRuntimePolicyError(activeCases, capability, message));
            recordTerminalActiveCases('runtime-policy', 0);
        },
        recordTerminalActiveCases,
        removeActiveCase(key) {
            activeCases.delete(key);
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
