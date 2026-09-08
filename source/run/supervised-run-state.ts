import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import type { PerTestResult, RunArtifact, RunnerError } from '../engine/run-result.ts';
import type { RunRequest } from './run-types.ts';

export type SupervisedCase = {
    readonly capture: RunRequest['capture'] | null;
    readonly id: CaseId;
};

export type StoredRunValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

export type SupervisedRunState = {
    readonly activeCases: ReadonlyMap<string, SupervisedCase>;
    readonly addActiveCase: (key: string, testCase: SupervisedCase) => void;
    readonly artifacts: () => readonly RunArtifact[];
    readonly caseArtifacts: (testCase: CaseId) => readonly RunArtifact[];
    readonly perTestResults: () => readonly PerTestResult[];
    readonly recordCapturedOutput: (
        stream: 'stderr' | 'stdout',
        chunk: Buffer,
        capturedAtMilliseconds: number
    ) => void;
    readonly recordPerTestResult: (key: string, result: PerTestResult) => void;
    readonly recordRunnerError: (error: RunnerError) => void;
    readonly recordRunnerErrors: (errors: readonly RunnerError[]) => void;
    readonly recordRuntimePolicyViolation: (capability: string, message: string) => void;
    readonly recordTerminalActiveCases: (verdict: PerTestResult['verdict']) => void;
    readonly removeActiveCase: (key: string) => void;
    readonly runnerErrors: () => readonly RunnerError[];
};

type CapturedOutputByteSpan = {
    readonly byteLength: number;
    readonly truncated: boolean;
    readonly usedBytes: number;
};

export const capturedOutputLimitBytes = Number('1048576');
const runArtifactScopeKey = 'run';

function terminalResult(testCase: SupervisedCase, verdict: PerTestResult['verdict']): PerTestResult {
    return {
        id: testCase.id,
        outcome: null,
        verdict
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
    chunk: Buffer
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
    const [ activeCase = null ] = policyActiveCaseIds;

    return {
        attributedTo: policyActiveCaseIds.length === 1 ? activeCase : null,
        cause: {
            activeCases: policyActiveCaseIds,
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
    const activeCases = new Map<string, SupervisedCase>();
    const artifacts: RunArtifact[] = [];
    const capturedOutputByteCounts = new Map<string, number>();
    const perTest = new Map<string, PerTestResult>();
    const runnerErrors: RunnerError[] = [];
    let artifactSequence = 0;
    const recordTerminalActiveCases = function recordTerminalActiveCases(verdict: PerTestResult['verdict']): void {
        for (const [ key, testCase ] of activeCases) {
            perTest.set(key, terminalResult(testCase, verdict));
        }

        activeCases.clear();
    };

    return {
        activeCases,
        addActiveCase(key, testCase) {
            activeCases.set(key, testCase);
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
        recordCapturedOutput(stream, chunk, capturedAtMilliseconds) {
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
                        capturedAtMilliseconds,
                        kind: 'captured-output',
                        stream,
                        text: chunk.subarray(0, captured.byteLength).toString('utf8'),
                        truncated: captured.truncated
                    },
                    source: 'boundary-captured'
                });
                artifactSequence += 1;
            }
        },
        recordPerTestResult(key, result) {
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
            recordTerminalActiveCases('runtime-policy');
        },
        recordTerminalActiveCases,
        removeActiveCase(key) {
            activeCases.delete(key);
        },
        runnerErrors() {
            return runnerErrors;
        }
    };
}
