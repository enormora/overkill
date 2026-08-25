import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import type { PerTestResult, RunnerError } from '../engine/run-result.ts';

export type SupervisedCase = {
    readonly id: CaseId;
};

export type StoredRunValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

export type SupervisedRunState = {
    readonly activeCases: ReadonlyMap<string, SupervisedCase>;
    readonly addActiveCase: (key: string, testCase: SupervisedCase) => void;
    readonly perTestResults: () => readonly PerTestResult[];
    readonly recordPerTestResult: (key: string, result: PerTestResult) => void;
    readonly recordRunnerError: (error: RunnerError) => void;
    readonly recordRunnerErrors: (errors: readonly RunnerError[]) => void;
    readonly recordRuntimePolicyViolation: (capability: string, message: string) => void;
    readonly recordTerminalActiveCases: (verdict: PerTestResult['verdict']) => void;
    readonly removeActiveCase: (key: string) => void;
    readonly runnerErrors: () => readonly RunnerError[];
};

function terminalResult(testCase: SupervisedCase, verdict: PerTestResult['verdict']): PerTestResult {
    return {
        id: testCase.id,
        outcome: null,
        verdict
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
    const perTest = new Map<string, PerTestResult>();
    const runnerErrors: RunnerError[] = [];
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
        perTestResults() {
            return Array.from(perTest.values());
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
