import type { DefinedReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { LoadedConfig } from '../config/config.ts';
import type { NormalizedConfig } from '../config/types.ts';
import { runCaseFactsFromTestPlan } from './run-facts.ts';
import { resolveResourceUsagePolicy, resolveTimingCollection } from './run-profile-facts.ts';
import { resultWithTimingCollection } from './run-timing-collection.ts';
import type { RunFacts, RunRequest } from './run-types.ts';
import { selectTestProfile } from './test-profile.ts';

type ResolvedRunSeed = {
    readonly value: bigint;
};

type DirectRunFactsInput = {
    readonly config: NormalizedConfig;
    readonly fileSet: string | null;
    readonly profileName: string;
    readonly projectRoot: string;
    readonly seed: ResolvedRunSeed;
    readonly testPlan: TestPlan;
};

function defaultRunRequest(profileName: string, seed: ResolvedRunSeed): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        coverage: false,
        debug: {
            mode: 'off',
            selectors: []
        },
        execution: { mode: 'profile-default' },
        measureResourceUsage: null,
        order: 'seeded',
        paths: [],
        profile: profileName,
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed,
        selection: { kind: 'all' },
        shard: {
            index: 0,
            total: 1
        },
        timingCollection: 'profile-default',
        verbose: false,
        workers: null
    };
}

export function runConfig(
    loadedConfig: LoadedConfig,
    reporters: readonly DefinedReporter[]
): NormalizedConfig {
    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: loadedConfig.profiles,
        reporters,
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

export function directRunFacts(input: DirectRunFactsInput): RunFacts {
    const request = defaultRunRequest(input.profileName, input.seed);
    if (!Object.hasOwn(input.config.profiles, input.profileName)) {
        throw new Error(`Unknown direct run profile: ${input.profileName}.`);
    }

    const profile = selectTestProfile(input.profileName, input.config);

    return {
        benchmarkCalibration: null,
        cases: runCaseFactsFromTestPlan(input.testPlan, function directRunFileSet() {
            return input.fileSet;
        }),
        coveragePolicy: null,
        durationHistory: null,
        environment: {
            node: {
                arch: process.arch,
                platform: process.platform,
                version: process.versions.node
            },
            projectRoot: input.projectRoot,
            runtimeStateDir: input.config.runtimeStateDir
        },
        execution: {
            attachments: profile.testFamily === 'integration' ? profile.attachments : null,
            baselineUpdateMode: request.baselineUpdateMode,
            capture: request.capture,
            coverage: request.coverage,
            debug: request.debug,
            engine: { kind: 'default' },
            maxConcurrency: profile.execution.maxConcurrency,
            order: request.order,
            placementPlan: null,
            processModel: 'in-process',
            profile: input.profileName,
            resourceUsagePolicy: resolveResourceUsagePolicy(request, profile),
            scheduling: profile.execution.scheduling,
            testFamily: profile.testFamily,
            retries: profile.testFamily === 'integration' ? profile.retries : null,
            timingCollection: resolveTimingCollection(request, profile),
            timeoutPolicy: profile.timeouts,
            verbose: request.verbose
        },
        loader: input.config.loader,
        reproducibility: {
            selection: request.selection,
            seed: String(input.seed.value),
            shard: request.shard,
            shardHashAlgorithm: 'xxh3-64-canonical-json-v1'
        }
    };
}

export function finalizeDirectRunResult(runFacts: RunFacts, result: RunResult): RunResult {
    return resultWithTimingCollection(runFacts.execution.timingCollection, result);
}
