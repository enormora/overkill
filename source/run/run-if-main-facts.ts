import type { DefinedReporter } from '../engine/reporter.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { LoadedRunConfig } from './run-config.ts';
import {
    resolveResourceUsagePolicy,
    runCaseFactsFromTestPlan
} from './run-facts.ts';
import { assertTestPlanMatchesTestFamily } from './run-selection.ts';
import type {
    RunConfig,
    RunFacts,
    RunProfileConfig,
    RunRequest
} from './run-types.ts';

type ResolvedRunSeed = {
    readonly value: bigint;
};

type DirectRunFactsInput = {
    readonly config: RunConfig;
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
        verbose: false
    };
}

export function runConfig(
    loadedConfig: LoadedRunConfig,
    reporters: readonly DefinedReporter[]
): RunConfig {
    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: loadedConfig.profiles,
        reporters,
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

function selectedProfile(config: RunConfig, profileName: string): RunProfileConfig {
    const profile = config.profiles[profileName];

    if (profile === undefined) {
        throw new Error(`Unknown direct run profile: ${profileName}.`);
    }

    return profile;
}

export function assertDirectTestPlanMatchesTestFamily(
    testPlan: TestPlan,
    testFamily: RunProfileConfig['testFamily']
): void {
    assertTestPlanMatchesTestFamily(testPlan, testFamily);
}

export function directRunFacts(input: DirectRunFactsInput): RunFacts {
    const request = defaultRunRequest(input.profileName, input.seed);
    const profile = selectedProfile(input.config, input.profileName);

    return {
        cases: runCaseFactsFromTestPlan(input.testPlan, function directRunFileSet() {
            return input.fileSet;
        }),
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
            baselineUpdateMode: request.baselineUpdateMode,
            capture: request.capture,
            debug: request.debug,
            engine: { kind: 'default' },
            order: request.order,
            processModel: 'in-process',
            profile: input.profileName,
            resourceUsagePolicy: resolveResourceUsagePolicy(request, profile),
            scheduling: profile.execution.scheduling,
            testFamily: profile.testFamily,
            timeoutPolicy: profile.timeouts,
            verbose: request.verbose
        },
        loader: input.config.loader,
        reproducibility: {
            selection: request.selection,
            seed: String(input.seed.value),
            shard: request.shard
        }
    };
}
