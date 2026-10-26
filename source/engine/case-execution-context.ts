import type { PropertyRunContext } from './property-execution-host.ts';
import type { BenchmarkAttempt } from './benchmark-attempt.ts';
import type { AttemptId } from './identity.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

export type CaseExecutionOptions = {
    readonly propertyRun: PropertyRunContext;
    readonly benchmarkEnvironment: BenchmarkAttempt['benchmarkEnvironment'];
    readonly onBenchmarkUpdate: BenchmarkAttempt['updateResult'];
    readonly attempt: AttemptId;
    readonly controller: AbortController;
    readonly runtimePolicy: TestRuntimePolicy | null;
};

export type TestRuntimePolicy = {
    readonly prepareAttempt: (testCase: TestPlanCase, attempt: AttemptId) => Promise<void>;
    readonly runAttempt: <Value>(
        testCase: TestPlanCase,
        attempt: AttemptId,
        run: () => Promise<Value>
    ) => Promise<Value>;
    readonly completeCase: (testCase: TestPlanCase, attempt: AttemptId) => Promise<void>;
    readonly runLoad: <Value>(run: () => Promise<Value>) => Promise<Value>;
    readonly takeAttemptErrors: (testCase: TestPlanCase, attempt: AttemptId) => readonly RunnerError[];
    readonly takePendingRunErrors: () => readonly RunnerError[];
    readonly takeRunErrors: () => readonly RunnerError[];
};
