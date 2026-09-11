import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { AssertionRecorder } from './assertion-recorder.ts';
import {
    createAsyncControlState,
    drainMicrotasks,
    registerCleanup,
    runCleanups,
    settleAsyncWork,
    startInFlight,
    validateInFlightTasks,
    yieldToNextTurn
} from './async-control.ts';
import { createRecordingAssertFacade } from './assertion-facade.ts';
import { createRecordingRequireFacade } from './require-assertion-facade.ts';
import type { TestContractFailure } from './run-result.ts';
import type { TestScope } from './test-node.ts';

type FinishedScopeLifecycle = {
    readonly cleanupErrors: readonly unknown[];
    readonly lifecycleFailures: readonly TestContractFailure[];
};

export type TestScopeLifecycle = {
    readonly createScope: (signal: AbortSignal) => TestScope;
    readonly finish: (controller: AbortController) => Promise<FinishedScopeLifecycle>;
    readonly runBody: (
        signal: AbortSignal,
        body: (scope: TestScope) => AssertionResult | Promise<AssertionResult>
    ) => Promise<AssertionResult>;
};

export function createTestScopeLifecycle(recorder: AssertionRecorder): TestScopeLifecycle {
    const state = createAsyncControlState();
    const assertContext = Object.assign(
        createRecordingAssertFacade(
            {
                failContract(failure) {
                    return recorder.failContract(failure);
                },
                recordAssert(assertion) {
                    recorder.recordAssert(assertion);
                },
                recordPendingAssert() {
                    return recorder.recordPendingAssert();
                }
            },
            null
        ),
        {
            collect() {
                return recorder.collect();
            }
        }
    );
    const createScope = function createScope(signal: AbortSignal): TestScope {
        return {
            assert: assertContext,
            cleanup(callback) {
                registerCleanup(state, callback);
            },
            drainMicrotasks,
            plan(count) {
                recorder.plan(count);
            },
            require: createRecordingRequireFacade(
                {
                    failContract(failure) {
                        return recorder.failContract(failure);
                    },
                    recordRequire(assertion) {
                        recorder.recordRequire(assertion);
                    }
                },
                null
            ),
            settleAsyncWork,
            signal,
            startInFlight(operation) {
                return startInFlight(state, assertContext, operation);
            },
            yieldToNextTurn
        };
    };

    return {
        createScope,
        async finish(controller) {
            controller.abort();

            const cleanupErrors = await runCleanups(state);

            await drainMicrotasks();

            return {
                cleanupErrors,
                lifecycleFailures: validateInFlightTasks(state)
            };
        },
        async runBody(signal, body) {
            return await body(createScope(signal));
        }
    };
}
