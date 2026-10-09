import type {
    NormalizedConfig,
    ProfilesConfig,
    ProfileConfig,
    ProfileFiles,
    LoaderConfig,
    ResourceBudgets,
    ResourceUsagePolicy,
    TimingProfilePolicy,
    TimeoutPolicy,
    MicrotestExecution,
    WorkGroup,
    WorkDistribution,
    HostProcess,
    BenchmarkExecution,
    IntegrationExecution,
    CoveragePolicy
} from './types.ts';

type ProfileFileSets = {
    readonly sets: NonNullable<ProfileFiles['sets']>;
};

function copyLoaderConfig(loader: LoaderConfig): LoaderConfig {
    return {
        sourceMaps: loader.sourceMaps,
        stripMode: loader.stripMode
    };
}

export function copyResourceBudgets(resourceBudgets: ResourceBudgets): ResourceBudgets {
    return {
        activeResourceCount: resourceBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: resourceBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: resourceBudgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: resourceBudgets.residentSetGrowthBytesPerSecond
    };
}

function copyResourceUsagePolicy(policy: ResourceUsagePolicy): ResourceUsagePolicy {
    return {
        budgets: copyResourceBudgets(policy.budgets),
        measure: policy.measure,
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    };
}

function copyTimingProfilePolicy(policy: TimingProfilePolicy): TimingProfilePolicy {
    return {
        collection: policy.collection
    };
}

function copyTimeoutPolicy(policy: TimeoutPolicy): TimeoutPolicy {
    return {
        collectionMilliseconds: policy.collectionMilliseconds,
        hardMilliseconds: policy.hardMilliseconds,
        softMilliseconds: policy.softMilliseconds
    };
}

function copyMicrotestExecution(execution: MicrotestExecution): MicrotestExecution {
    return {
        maxConcurrency: execution.maxConcurrency,
        processModel: execution.processModel,
        scheduling: execution.scheduling
    };
}

function copyWorkGroup(group: WorkGroup): WorkGroup {
    return {
        fileSets: [ group.fileSets[0], ...group.fileSets.slice(1) ],
        granularity: group.granularity,
        name: group.name,
        order: group.order,
        scheduling: group.scheduling,
        workerLifecycle: group.workerLifecycle
    };
}

function copyWorkDistribution(distribution: WorkDistribution): WorkDistribution {
    if (distribution.mode !== 'group') {
        return { mode: distribution.mode };
    }

    return {
        groups: [
            copyWorkGroup(distribution.groups[0]),
            ...distribution.groups.slice(1).map(copyWorkGroup)
        ],
        mode: 'group',
        unmatched: distribution.unmatched
    };
}

function copyHostProcess(hostProcess: HostProcess): HostProcess {
    if (hostProcess.kind === 'direct') {
        return { kind: 'direct' };
    }

    return {
        kind: 'child',
        nodeArguments: Array.from(hostProcess.nodeArguments)
    };
}

function copyIntegrationExecution(execution: IntegrationExecution): IntegrationExecution {
    if (execution.processModel === 'worker-pool') {
        return {
            assignmentPolicy: execution.assignmentPolicy,
            dispatchPolicy: execution.dispatchPolicy,
            hedging: { ...execution.hedging },
            hostProcess: copyHostProcess(execution.hostProcess),
            maxConcurrency: execution.maxConcurrency,
            maxWorkers: execution.maxWorkers,
            processModel: execution.processModel,
            scheduling: execution.scheduling,
            workDistribution: copyWorkDistribution(execution.workDistribution),
            workerLifecycle: execution.workerLifecycle
        };
    }

    return {
        maxConcurrency: execution.maxConcurrency,
        processModel: execution.processModel,
        scheduling: execution.scheduling
    };
}

function hasProfileFileSets(files: ProfileFiles): files is ProfileFileSets {
    return files.sets !== undefined;
}

function copyProfileFiles(files: ProfileFiles): ProfileFiles {
    if (hasProfileFileSets(files)) {
        return {
            sets: Object.fromEntries(
                Object.entries(files.sets).map(function copyProfileFileSet([ name, set ]) {
                    return [
                        name,
                        {
                            exclude: Array.from(set.exclude),
                            include: [ set.include[0], ...set.include.slice(1) ]
                        }
                    ];
                })
            )
        };
    }

    return {
        exclude: Array.from(files.exclude),
        include: [ files.include[0], ...files.include.slice(1) ]
    };
}

function copyCoveragePolicy(policy: CoveragePolicy): CoveragePolicy {
    return {
        outputDirectory: policy.outputDirectory,
        outputs: Array.from(policy.outputs),
        sources: policy.sources.mode === 'loaded'
            ? { exclude: Array.from(policy.sources.exclude), mode: 'loaded' }
            : {
                exclude: Array.from(policy.sources.exclude),
                include: [ policy.sources.include[0], ...policy.sources.include.slice(1) ],
                mode: 'all'
            },
        thresholds: {
            branches: policy.thresholds.branches,
            functions: policy.thresholds.functions,
            lines: policy.thresholds.lines
        }
    };
}

function copyIntegrationFiles(files: ProfileFiles | null): ProfileFiles {
    if (files === null) {
        throw new Error('Integration profiles require files.');
    }

    return copyProfileFiles(files);
}

function copyReporters(reporters: NormalizedConfig['reporters']): NormalizedConfig['reporters'] {
    return reporters === null ? null : Array.from(reporters);
}

function copyBenchmarkExecution(execution: BenchmarkExecution): BenchmarkExecution {
    return execution.processModel === 'worker-pool'
        ? {
            ...execution,
            hedging: { mode: 'off' },
            hostProcess: copyHostProcess(execution.hostProcess),
            workDistribution: copyWorkDistribution(execution.workDistribution)
        }
        : { ...execution };
}

function copyProfileConfig(profile: ProfileConfig): ProfileConfig {
    if (profile.testFamily === 'benchmark') {
        return {
            attachments: { ...profile.attachments },
            execution: copyBenchmarkExecution(profile.execution),
            files: copyProfileFiles(profile.files),
            reporters: copyReporters(profile.reporters),
            resourceUsage: copyResourceUsagePolicy(profile.resourceUsage),
            testFamily: profile.testFamily,
            timings: copyTimingProfilePolicy(profile.timings),
            timeouts: copyTimeoutPolicy(profile.timeouts)
        };
    }

    if (profile.testFamily === 'integration') {
        return {
            attachments: { ...profile.attachments },
            execution: copyIntegrationExecution(profile.execution),
            files: copyIntegrationFiles(profile.files),
            reporters: copyReporters(profile.reporters),
            retries: profile.retries === null ? null : { ...profile.retries },
            resourceUsage: copyResourceUsagePolicy(profile.resourceUsage),
            testFamily: profile.testFamily,
            timings: copyTimingProfilePolicy(profile.timings),
            timeouts: copyTimeoutPolicy(profile.timeouts)
        };
    }

    return {
        coverage: copyCoveragePolicy(profile.coverage),
        execution: copyMicrotestExecution(profile.execution),
        files: profile.files === null ? null : copyProfileFiles(profile.files),
        reporters: copyReporters(profile.reporters),
        resourceUsage: copyResourceUsagePolicy(profile.resourceUsage),
        testFamily: profile.testFamily,
        timings: copyTimingProfilePolicy(profile.timings),
        timeouts: copyTimeoutPolicy(profile.timeouts)
    };
}

function copyProfilesConfig(profiles: ProfilesConfig): ProfilesConfig {
    return Object.fromEntries(
        Object.entries(profiles).map(function copyProfileEntry([ name, profile ]) {
            return [ name, copyProfileConfig(profile) ];
        })
    );
}

export function copyConfig(config: NormalizedConfig): NormalizedConfig {
    return {
        loader: copyLoaderConfig(config.loader),
        outputRenderer: config.outputRenderer,
        profiles: copyProfilesConfig(config.profiles),
        reporters: copyReporters(config.reporters),
        runtimeStateDir: config.runtimeStateDir
    };
}
