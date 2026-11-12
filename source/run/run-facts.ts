import {
    profileFamilyId,
    type NormalizedConfig,
    type ProfileConfig,
    type Scheduling
} from '../config/types.ts';

import { debuggedWork, runHasAttachmentScopes } from './run-diagnostics.ts';
import {
    resolveProcessUsagePolicy,
    resolveRunRecordPersistence,
    resolveTimingCollection
} from './run-profile-facts.ts';
import { selectProfile } from './test-profile.ts';
import { hostProcessFacts } from './run-host-process.ts';
import { runShardHashAlgorithm } from './run-shard-hash-algorithm.ts';
import { runEngineFacts } from './run-support.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type {
    DurationHistoryInput,
    PlacementPlan,
    RunCaseFacts,
    RunCommand,
    RunExecutionFacts,
    RunFacts,
    RunHostProcessFacts,
    ResolvedRun,
    RunRequest,
    RunWorkerCountFacts
} from './run-types.ts';

type RunFactsDependencies = Pick<RunOrchestratorDependencies, 'createSeed' | 'node'>;

export type RunFactsInput = {
    readonly hostProcess: RunHostProcessFacts | null;
    readonly benchmarkHost: RunFacts['benchmarkHost'];
    readonly benchmarkPlacement: RunFacts['benchmarkPlacement'];
    readonly benchmarkCalibration: RunFacts['benchmarkCalibration'];
    readonly benchmarkNormalization: RunFacts['benchmarkNormalization'];
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

function resolvedSeed(request: RunRequest, dependencies: RunFactsDependencies): bigint {
    return request.seed.value ?? dependencies.createSeed();
}

function executionFamilyFacts(
    profile: ProfileConfig
): Pick<RunExecutionFacts, 'attachments' | 'benchmarkGarbageCollection' | 'propertyPolicy' | 'retries'> {
    if (profile.testFamily === 'benchmark') {
        return {
            attachments: profile.attachments,
            benchmarkGarbageCollection: profile.garbageCollection,
            propertyPolicy: null,
            retries: null
        };
    }
    if (profile.testFamily === 'integration') {
        return {
            attachments: profile.attachments,
            benchmarkGarbageCollection: null,
            propertyPolicy: null,
            retries: profile.retries
        };
    }
    if (profile.testFamily === 'property') {
        return { attachments: null, benchmarkGarbageCollection: null, propertyPolicy: profile.property, retries: null };
    }
    return { attachments: null, benchmarkGarbageCollection: null, propertyPolicy: null, retries: null };
}

function createRunExecutionFacts(
    input: RunFactsInput,
    profile: ProfileConfig
): RunExecutionFacts {
    const facts = {
        ...executionFamilyFacts(profile),
        baselineUpdateMode: input.request.baselineUpdateMode,
        capture: input.request.capture,
        coverage: input.request.coverage,
        runRecords: resolveRunRecordPersistence(input.request, profile),
        debug: input.request.debug,
        debuggedCases: [],
        engine: runEngineFacts(input.engine),
        maxConcurrency: profile.execution.maxConcurrency,
        order: input.request.order,
        placementPlan: input.placementPlan,
        profile: input.request.profile,
        processUsagePolicy: resolveProcessUsagePolicy(input.request, profile),
        scheduling: input.scheduling,
        testFamily: profileFamilyId(profile),
        failureArtifacts: profile.failureArtifacts,
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
            hostProcess: input.hostProcess ?? hostProcessFacts(profile.execution.hostProcess),
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

export function createRunFacts(input: RunFactsInput): RunFacts {
    const profile = selectProfile(input.request.profile, input.config);

    return {
        adapter: null,
        benchmarkHost: input.benchmarkHost,
        benchmarkPlacement: input.benchmarkPlacement,
        benchmarkCalibration: input.benchmarkCalibration,
        benchmarkNormalization: input.benchmarkNormalization,
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

export function resolveRunDiagnostics(input: ResolvedRun): ResolvedRun {
    const resolved: ResolvedRun = {
        ...input,
        facts: { ...input.facts, execution: { ...input.facts.execution, debuggedCases: debuggedWork(input) } }
    };
    if (!runHasAttachmentScopes(resolved)) {
        return resolved;
    }
    const policy = resolved.facts.execution.runRecords;
    return {
        ...resolved,
        facts: {
            ...resolved.facts,
            execution: {
                ...resolved.facts.execution,
                runRecords: { persist: true, reasons: [ ...policy.reasons, 'artifact' ] }
            }
        }
    };
}
