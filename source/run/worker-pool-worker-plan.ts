import {
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from '../engine/execution-global-error-observer.ts';
import { createDefaultWorkId, workIdentityKey, type CaseId, type WorkId } from '../engine/identity.ts';
import { createHostTestPlan, resolveHostEngine } from './host-test-plan.ts';
import type { RunnerError, TestPlan } from './run-engine-primitives.ts';
import { assertFrozenWorkloadInputs } from './workload-input-validation.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import {
    loadRunEngineModule,
    loadRunTestModules,
    runDiscovery
} from './node-run-dependencies.entry-point.ts';
import { createRunTestPlan } from './run-test-plan.ts';
import { RunCollectionError } from './run-errors.ts';
import type {
    WorkerPoolCollection,
    WorkerPoolRunTask,
    WorkerPoolCommand,
    WorkerPoolRunOutput
} from './worker-pool-protocol.ts';

export type CollectedWorkerPoolTestPlan = {
    readonly runnerErrors: readonly RunnerError[];
    readonly testPlan: TestPlan;
};

type AssignedWork = readonly WorkId[];
const missingObservedWorkerError: RunnerError = {
    attributedToAttempt: null,
    attributedTo: null,
    attributedToWork: null,
    cause: null,
    diagnostics: [],
    message: 'Worker-pool worker failed after a process-level runtime error.',
    subtype: 'crash'
};

function firstObservedWorkerError(observer: ExecutionGlobalErrorObserver): RunCollectionError {
    const [ error ] = [ ...observer.takeErrors(), missingObservedWorkerError ];

    return new RunCollectionError(
        error.message,
        { cause: error },
        error.subtype
    );
}

async function waitForObservedWorkerError(observer: ExecutionGlobalErrorObserver): Promise<never> {
    await observer.fatalSignal();
    throw firstObservedWorkerError(observer);
}

export async function runObservedWorkerCollection<Value>(collect: () => Promise<Value>): Promise<Value> {
    const globalErrorObserver = createExecutionGlobalErrorObserver('worker-pool-worker');

    try {
        return await globalErrorObserver.runBoundary(async function collectObservedWorkerPlan() {
            return await globalErrorObserver.runPhase('collection', async function collectObservedPlan() {
                return await Promise.race([
                    collect(),
                    waitForObservedWorkerError(globalErrorObserver)
                ]);
            });
        });
    } finally {
        globalErrorObserver.stop();
    }
}

async function createWorkerPoolTestPlan(command: WorkerPoolCommand): Promise<TestPlan> {
    const engine = await resolveHostEngine(command.engine, loadRunEngineModule);
    return await createHostTestPlan({
        processModel: 'worker-pool',
        command: { ...command, propertyPolicy: null },
        engine,
        async collect(policy, replay) {
            return await createRunTestPlan({
                replay,
                cwd: command.cwd,
                definitionLocationCapture: command.family?.definitionLocationCapture ??
                    command.definitionLocationCapture,
                discoverRunFiles: runDiscovery.discoverRunFiles,
                engine,
                loadRunTestModules,
                paths: command.paths,
                root: command.root,
                testFamily: command.testFamily
            }, policy);
        }
    });
}

export async function collectTestPlan(command: WorkerPoolCommand): Promise<CollectedWorkerPoolTestPlan> {
    return {
        runnerErrors: [],
        testPlan: await createWorkerPoolTestPlan(command)
    };
}

export function sendCollectedPlan(collectedPlan: CollectedWorkerPoolTestPlan): WorkerPoolCollection {
    return {
        collectedPlan: collectedRunPlanFromTestPlan(collectedPlan.testPlan),
        runnerErrors: collectedPlan.runnerErrors
    };
}

export function selectedAssignedWork(
    testPlan: TestPlan,
    assignedWork: AssignedWork,
    workloadInputs: WorkerPoolRunTask['workloadInputs']
): TestPlan {
    const casesByIdentity = new Map(testPlan.cases.map(function toCaseEntry(testCase) {
        return [ workIdentityKey(testCase.workId), testCase ];
    }));
    const cases = assignedWork.flatMap(function toAssignedCase(work) {
        const matchedCase = casesByIdentity.get(workIdentityKey(work));

        return matchedCase === undefined ? [] : [ matchedCase ];
    });
    const firstCase = cases[0];

    if (firstCase === undefined || cases.length !== assignedWork.length) {
        throw new Error('Worker-pool test plan did not match assigned work identities.');
    }

    const selected: TestPlan = { ...testPlan, cases: [ firstCase, ...cases.slice(1) ] };
    assertFrozenWorkloadInputs(selected, workloadInputs);
    return selected;
}

export function selectedAssignedCases(testPlan: TestPlan, assignedCases: readonly CaseId[]): TestPlan {
    return selectedAssignedWork(testPlan, assignedCases.map(createDefaultWorkId), []);
}

export function createEmptyAssignmentResult(): WorkerPoolRunOutput {
    return {
        results: []
    };
}
