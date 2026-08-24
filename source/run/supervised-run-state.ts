import type { PerTestResult, RunnerError } from '../engine/run-result.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';

export type StoredRunValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

export type SupervisedRunState = {
    readonly activeCases: ReadonlyMap<string, TestPlanCase>;
    readonly addActiveCase: (key: string, testCase: TestPlanCase) => void;
    readonly perTestResults: () => readonly PerTestResult[];
    readonly recordPerTestResult: (key: string, result: PerTestResult) => void;
    readonly recordRunnerError: (error: RunnerError) => void;
    readonly recordRunnerErrors: (errors: readonly RunnerError[]) => void;
    readonly recordRuntimePolicyViolation: (capability: string, message: string) => void;
    readonly recordTerminalActiveCases: (verdict: PerTestResult['verdict']) => void;
    readonly removeActiveCase: (key: string) => void;
    readonly runnerErrors: () => readonly RunnerError[];
};

function terminalResult(testCase: TestPlanCase, verdict: PerTestResult['verdict']): PerTestResult {
    return {
        id: testCase.id,
        outcome: null,
        verdict
    };
}

function createRuntimePolicyError(
    activeCases: ReadonlyMap<string, TestPlanCase>,
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
    const activeCases = new Map<string, TestPlanCase>();
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
