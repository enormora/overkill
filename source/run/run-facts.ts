import { serializeValue } from '../compare/serialized-value.ts';
import type { TestPlan } from '../engine/test-plan.ts';

import type { NormalizedConfig, TestProfileConfig, Scheduling } from '../config/types.ts';
import { resolveResourceUsagePolicy, resolveTimingCollection } from './run-profile-facts.ts';
import { selectTestProfile } from './test-profile.ts';

import { hostProcessFacts } from './run-host-process.ts';
import { runShardHashAlgorithm } from './run-shard-hash-algorithm.ts';
import { runEngineFacts } from './run-support.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type {
    RunCaseFacts,
    RunCommand,
    DurationHistoryInput,
    RunFacts,
    RunExecutionFacts,
    PlacementPlan,
    RunRequest,
    RunWorkerCountFacts
} from './run-types.ts';

type RunFactsDependencies = Pick<RunOrchestratorDependencies, 'createSeed' | 'node'>;

export type RunFactsInput = {
    readonly cases: readonly RunCaseFacts[];
    readonly config: NormalizedConfig;
    readonly dependencies: RunFactsDependencies;
    readonly durationHistory: DurationHistoryInput | null;
    readonly engine: RunCommand['engine'];
    readonly placementPlan: PlacementPlan | null;
    readonly projectRoot: string;
    readonly request: RunRequest;
    readonly scheduling: Scheduling;
    readonly workerCount: RunWorkerCountFacts | null;
};

export type RunCaseFileSet = (file: RunCaseFacts['id']['file']) => string | null;

function resolvedSeed(request: RunRequest, dependencies: RunFactsDependencies): bigint {
    return request.seed.value ?? dependencies.createSeed();
}

function createRunExecutionFacts(
    input: RunFactsInput,
    profile: TestProfileConfig
): RunExecutionFacts {
    const facts = {
        attachments: profile.testFamily === 'integration' ? profile.attachments : null,
        baselineUpdateMode: input.request.baselineUpdateMode,
        capture: input.request.capture,
        coverage: input.request.coverage,
        debug: input.request.debug,
        engine: runEngineFacts(input.engine),
        maxConcurrency: profile.execution.maxConcurrency,
        order: input.request.order,
        placementPlan: input.placementPlan,
        profile: input.request.profile,
        retries: profile.testFamily === 'integration' ? profile.retries : null,
        resourceUsagePolicy: resolveResourceUsagePolicy(input.request, profile),
        scheduling: input.scheduling,
        testFamily: profile.testFamily,
        timingCollection: resolveTimingCollection(input.request, profile),
        timeoutPolicy: profile.timeouts,
        verbose: input.request.verbose
    };

    if (profile.execution.processModel === 'worker-pool') {
        if (input.workerCount === null) {
            throw new Error('Worker-pool execution facts require worker-count resolution.');
        }

        return {
            ...facts,
            assignmentPolicy: profile.execution.assignmentPolicy,
            dispatchPolicy: profile.execution.dispatchPolicy,
            hedging: profile.execution.hedging,
            hostProcess: hostProcessFacts(profile.execution.hostProcess),
            processModel: profile.execution.processModel,
            workerCount: input.workerCount,
            workDistribution: profile.execution.workDistribution,
            workerLifecycle: profile.execution.workerLifecycle
        };
    }

    return {
        ...facts,
        processModel: profile.execution.processModel
    };
}

export function runCaseFactsFromTestPlan(
    testPlan: TestPlan,
    fileSetForCase: RunCaseFileSet
): readonly RunCaseFacts[] {
    return testPlan.cases.map(function toRunCaseFacts(testCase) {
        return {
            annotations: serializeValue(testCase.annotations),
            controls: serializeValue(testCase.controls),
            fileSet: fileSetForCase(testCase.id.file),
            id: testCase.id,
            workId: testCase.workId
        };
    });
}

export function createRunFacts(input: RunFactsInput): RunFacts {
    const profile = selectTestProfile(input.request.profile, input.config);

    return {
        cases: input.cases,
        coveragePolicy: input.request.coverage && profile.testFamily === 'microtest' ? profile.coverage : null,
        durationHistory: input.durationHistory,
        environment: {
            node: {
                arch: input.dependencies.node.arch,
                platform: input.dependencies.node.platform,
                version: input.dependencies.node.version
            },
            projectRoot: input.projectRoot,
            runtimeStateDir: input.config.runtimeStateDir
        },
        execution: createRunExecutionFacts(input, profile),
        loader: input.config.loader,
        reproducibility: {
            selection: input.request.selection,
            seed: resolvedSeed(input.request, input.dependencies).toString(),
            shard: input.request.shard,
            shardHashAlgorithm: runShardHashAlgorithm
        }
    };
}
