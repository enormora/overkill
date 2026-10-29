import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import type { TestBody } from '../packages/test/test.entry-point.ts';
import { createExecutionSupervision, executeCaseBody, type ConcurrentCase } from '../engine/execution-supervision.ts';
import { createExecutionGlobalErrorObserver } from '../engine/execution-global-error-observer.ts';
import type { TestRuntimePolicy } from '../engine/case-execution-context.ts';
import { createTestEngine } from './create-test-engine.ts';

export type InterruptedCase = {
    readonly clock: DeterministicClock;
    readonly stop: () => void;
    readonly run: () => Promise<ConcurrentCase>;
};

async function ignoreBenchmarkUpdate(): Promise<void> {
    return undefined;
}

export function createInterruptedCase(body: TestBody, policy: TestRuntimePolicy | null): InterruptedCase {
    const engine = createTestEngine();
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const observer = createExecutionGlobalErrorObserver('in-process');
    const supervision = createExecutionSupervision();
    const testCase = engine
        .createTestPlan(engine.createRoot({
            title: 'interrupted',
            annotations: {},
            controls: {},
            children: [ engine.createTestCase({
                title: 'case',
                body,
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ]
            }) ]
        }))
        .cases[0];
    return {
        clock,
        stop() {
            observer.stop();
        },
        async run() {
            return await observer.runBoundary(async function observeInterruptedRun() {
                return await observer.runCase(testCase, { index: 0 }, async function observeInterruptedCase() {
                    return await executeCaseBody({
                        seed: 0n,
                        propertyRun: { seed: 0n, projectRoot: null },
                        testCase,
                        attempt: { index: 0 },
                        supervision,
                        timeoutPolicy: { timeoutMilliseconds: 100, hardTimeoutMilliseconds: 10 },
                        dependencies: {
                            wallClock: clock,
                            globalErrorObserver: observer,
                            benchmarkEnvironment: null,
                            runtimePolicy: policy
                        },
                        onPropertyUpdate: ignoreBenchmarkUpdate,
                        onBenchmarkUpdate: ignoreBenchmarkUpdate
                    });
                });
            });
        }
    };
}
