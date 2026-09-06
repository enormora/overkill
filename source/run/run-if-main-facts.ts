import type { Reporter } from '../engine/reporter.ts';
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
    RunMicrotestProfileConfig,
    RunRequest
} from './run-types.ts';

function defaultRunRequest(profileName: string): RunRequest {
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
        order: 'plan',
        paths: [],
        profile: profileName,
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed: { value: 0n },
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
    reporters: readonly Reporter[]
): RunConfig {
    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: loadedConfig.profiles,
        reporters,
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

function selectedProfile(config: RunConfig, profileName: string): RunMicrotestProfileConfig {
    const profile = config.profiles[profileName];

    if (profile === undefined) {
        throw new Error(`Unknown direct run profile: ${profileName}.`);
    }

    return profile;
}

export function assertDirectTestPlanMatchesTestFamily(
    testPlan: TestPlan,
    testFamily: RunMicrotestProfileConfig['testFamily']
): void {
    assertTestPlanMatchesTestFamily(testPlan, testFamily);
}

export function directRunFacts(
    config: RunConfig,
    profileName: string,
    testPlan: TestPlan
): RunFacts {
    const request = defaultRunRequest(profileName);
    const profile = selectedProfile(config, profileName);

    return {
        cases: runCaseFactsFromTestPlan(testPlan),
        environment: {
            node: {
                arch: process.arch,
                platform: process.platform,
                version: process.versions.node
            },
            runtimeStateDir: config.runtimeStateDir
        },
        execution: {
            baselineUpdateMode: request.baselineUpdateMode,
            capture: request.capture,
            debug: request.debug,
            engine: { kind: 'default' },
            order: request.order,
            processModel: 'in-process',
            profile: profileName,
            resourceUsagePolicy: resolveResourceUsagePolicy(request, profile),
            scheduling: profile.execution.scheduling,
            testFamily: profile.testFamily,
            timeoutPolicy: profile.timeouts,
            verbose: request.verbose
        },
        loader: config.loader,
        reproducibility: {
            selection: request.selection,
            seed: '0',
            shard: request.shard
        }
    };
}
