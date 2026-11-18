import { EventEmitter } from 'node:events';
import { createResourceLifecycleSession } from '../run/resource-lifecycle.ts';
import { withProjectedFailurePreparation } from '../run/worker-pool-worker-resources.ts';
import type { WorkerPoolMessage, WorkerTaskPort } from '../run/worker-pool-protocol.ts';
import type { TestRuntimePolicy } from '../engine/case-execution-context.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { managedCase } from './managed-resource-acquisition.ts';
import { workerTaskRuntime } from './worker-task-runtime.ts';

export type PreparationScenario = 'closed' | 'empty' | 'error' | 'success' | 'throw';
const preparationFailure: RunnerError = {
    attributedTo: null,
    attributedToAttempt: null,
    attributedToWork: null,
    cause: null,
    diagnostics: [],
    message: 'owner failed',
    subtype: 'artifact'
};
type ProjectedPreparationFixture = {
    readonly policy: TestRuntimePolicy;
    readonly testCase: TestPlanCase;
    readonly sent: readonly WorkerPoolMessage[];
    readonly listeners: () => number;
    readonly dispose: () => Promise<void>;
};
export function projectedPreparation(scenario: PreparationScenario): ProjectedPreparationFixture {
    const testCase = managedCase();
    const sent: WorkerPoolMessage[] = [];
    const emitter = new EventEmitter();
    const session = createResourceLifecycleSession({
        testCases: [ testCase ],
        boundaryUseCounts: [],
        caseDisposalScopes: new Set(),
        projectedResources: { resources: [] },
        timing: null
    });
    const port: WorkerTaskPort = {
        on: emitter.on.bind(emitter),
        off: emitter.off.bind(emitter),
        once: emitter.once.bind(emitter),
        close() {
            emitter.emit('close');
        },
        postMessage(message: WorkerPoolMessage) {
            sent.push(message);
            if (message.kind === 'prepare-resource-artifacts') {
                if (scenario === 'closed') {
                    emitter.emit('close');
                } else if (scenario === 'throw') {
                    throw new Error('send failed');
                } else {
                    emitter.emit('message', {
                        kind: 'resource-artifacts-prepared',
                        request: 'unrelated',
                        runnerErrors: [ preparationFailure ]
                    });
                    emitter.emit('message', {
                        kind: 'resource-artifacts-prepared',
                        request: message.request,
                        runnerErrors: scenario === 'error' ? [ preparationFailure ] : []
                    });
                }
            }
        }
    };
    const { task } = workerTaskRuntime(null, null);
    const policy = withProjectedFailurePreparation(session.runtimePolicy, {
        ...task,
        lifecycle: { endpoint: null, token: `remote-preparation:${scenario}` },
        port,
        projectedResources: { resources: scenario === 'empty' ? [] : [ { boundaryKey: 'run:owner', payload: {} } ] }
    });
    return {
        policy,
        testCase,
        sent,
        listeners() {
            return emitter.listenerCount('message') + emitter.listenerCount('close');
        },
        async dispose() {
            const controller = new AbortController();
            await session.disposeAll(controller.signal);
        }
    };
}
