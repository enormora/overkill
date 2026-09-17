import type { createWallClock } from '@enormora/wall-clock';
import type { Engine } from '../engine/engine.ts';
import { createDefaultWorkId, workIdentityKey, type CaseId, type WorkId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { TestPlan } from '../packages/engine/engine.entry-point.ts';
import {
    collectedRunPlanFromTestPlan,
    collectedRunPlanFromTestPlanCases,
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import {
    loadRunEngineModule,
    loadRunTestModules,
    runDiscovery
} from './node-run-dependencies.entry-point.ts';
import { createRunTestPlan } from './run-test-plan.ts';
import type {
    WorkerPoolCollection,
    WorkerPoolCommand,
    WorkerPoolRunOutput
} from './worker-pool-protocol.ts';

export type CollectedWorkerPoolTestPlan = {
    readonly runnerErrors: readonly RunnerError[];
    readonly testPlan: TestPlan;
};

type AssignedWork = readonly WorkId[];

async function selectedEngine(command: WorkerPoolCommand): Promise<Engine> {
    return command.engine.kind === 'module' ? await loadRunEngineModule(command.engine) : defaultRunEngine;
}

async function createWorkerPoolTestPlan(command: WorkerPoolCommand): Promise<TestPlan> {
    return await createRunTestPlan({
        cwd: command.cwd,
        discoverRunFiles: runDiscovery.discoverRunFiles,
        engine: await selectedEngine(command),
        loadRunTestModules,
        paths: command.paths,
        testFamily: command.testFamily
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

export function selectedAssignedWork(testPlan: TestPlan, assignedWork: AssignedWork): TestPlan {
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

    return {
        ...testPlan,
        cases: [ firstCase, ...cases.slice(1) ]
    };
}

export function selectedAssignedCases(testPlan: TestPlan, assignedCases: readonly CaseId[]): TestPlan {
    return selectedAssignedWork(testPlan, assignedCases.map(createDefaultWorkId));
}

export function createEmptyAssignmentResult(
    testPlan: TestPlan,
    wallClock: ReturnType<typeof createWallClock>,
    startedAtMilliseconds: number
): WorkerPoolRunOutput {
    return {
        result: createRunResultFromCollectedPlan(
            collectedRunPlanFromTestPlanCases(testPlan, []),
            [],
            [],
            {
                planStatus: 'empty-selection',
                resourceUsage: null,
                startedAtMs: startedAtMilliseconds,
                wallClock
            }
        )
    };
}
