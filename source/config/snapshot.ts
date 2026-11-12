import {
    type DefinedFamilyProfile,
    isDefinedFamilyProfile,
    type NormalizedConfig,
    type ProfilesConfig,
    type ProfileConfig,
    type ProfileFiles,
    type LoaderConfig,
    type ProcessBudgets,
    type ProcessUsagePolicy,
    type TimingProfilePolicy,
    type TimeoutPolicy,
    type MicrotestExecution,
    type WorkGroup,
    type WorkDistribution,
    type HostProcess,
    type BenchmarkExecution,
    type IntegrationExecution,
    type CoveragePolicy
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

export function copyProcessBudgets(processBudgets: ProcessBudgets): ProcessBudgets {
    return {
        activeResourceCount: processBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: processBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: processBudgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: processBudgets.residentSetGrowthBytesPerSecond
    };
}

function copyProcessUsagePolicy(policy: ProcessUsagePolicy): ProcessUsagePolicy {
    return {
        budgets: copyProcessBudgets(policy.budgets),
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

function copyDefinedFamilyProfile(profile: DefinedFamilyProfile): DefinedFamilyProfile {
    return {
        ...profile,
        testFamily: profile.testFamily,
        execution: profile.execution.processModel === 'worker-pool'
            ? copyIntegrationExecution(profile.execution)
            : copyMicrotestExecution(profile.execution),
        files: copyProfileFiles(profile.files),
        reporters: copyReporters(profile.reporters),
        processUsage: copyProcessUsagePolicy(profile.processUsage),
        runRecords: { ...profile.runRecords },
        timeouts: { ...profile.timeouts },
        timings: { ...profile.timings },
        failureArtifacts: structuredClone(profile.failureArtifacts)
    };
}

function copyBuiltinProfileConfig(profile: Exclude<ProfileConfig, DefinedFamilyProfile>): ProfileConfig {
    if (profile.testFamily === 'property') {
        return {
            baselines: { ...profile.baselines, adapters: Array.from(profile.baselines.adapters) },
            execution: copyMicrotestExecution(profile.execution),
            files: copyProfileFiles(profile.files),
            reporters: copyReporters(profile.reporters),
            processUsage: copyProcessUsagePolicy(profile.processUsage),
            corpus: { checkedIn: Array.from(profile.corpus.checkedIn), localCache: { ...profile.corpus.localCache } },
            property: { ...profile.property },
            testFamily: profile.testFamily,
            runRecords: { ...profile.runRecords },
            failureArtifacts: {
                ...profile.failureArtifacts,
                serialization: { ...profile.failureArtifacts.serialization },
                rendering: { ...profile.failureArtifacts.rendering }
            },
            timings: copyTimingProfilePolicy(profile.timings),
            timeouts: copyTimeoutPolicy(profile.timeouts)
        };
    }
    if (profile.testFamily === 'benchmark') {
        return {
            attachments: { ...profile.attachments },
            garbageCollection: profile.garbageCollection,
            baselines: { adapters: Array.from(profile.baselines.adapters), directory: profile.baselines.directory },
            host: { limits: { ...profile.host.limits } },
            execution: copyBenchmarkExecution(profile.execution),
            files: copyProfileFiles(profile.files),
            reporters: copyReporters(profile.reporters),
            processUsage: copyProcessUsagePolicy(profile.processUsage),
            testFamily: profile.testFamily,
            runRecords: { ...profile.runRecords },
            failureArtifacts: {
                ...profile.failureArtifacts,
                serialization: { ...profile.failureArtifacts.serialization },
                rendering: { ...profile.failureArtifacts.rendering }
            },
            timings: copyTimingProfilePolicy(profile.timings),
            timeouts: copyTimeoutPolicy(profile.timeouts)
        };
    }

    if (profile.testFamily === 'integration') {
        return {
            baselines: { ...profile.baselines, adapters: Array.from(profile.baselines.adapters) },
            attachments: { ...profile.attachments },
            execution: copyIntegrationExecution(profile.execution),
            files: copyIntegrationFiles(profile.files),
            reporters: copyReporters(profile.reporters),
            retries: profile.retries === null ? null : { ...profile.retries },
            processUsage: copyProcessUsagePolicy(profile.processUsage),
            testFamily: profile.testFamily,
            runRecords: { ...profile.runRecords },
            failureArtifacts: {
                ...profile.failureArtifacts,
                serialization: { ...profile.failureArtifacts.serialization },
                rendering: { ...profile.failureArtifacts.rendering }
            },
            timings: copyTimingProfilePolicy(profile.timings),
            timeouts: copyTimeoutPolicy(profile.timeouts)
        };
    }

    return {
        baselines: { ...profile.baselines, adapters: Array.from(profile.baselines.adapters) },
        coverage: copyCoveragePolicy(profile.coverage),
        execution: copyMicrotestExecution(profile.execution),
        files: profile.files === null ? null : copyProfileFiles(profile.files),
        reporters: copyReporters(profile.reporters),
        processUsage: copyProcessUsagePolicy(profile.processUsage),
        testFamily: profile.testFamily,
        runRecords: { ...profile.runRecords },
        failureArtifacts: {
            ...profile.failureArtifacts,
            serialization: { ...profile.failureArtifacts.serialization },
            rendering: { ...profile.failureArtifacts.rendering }
        },
        timings: copyTimingProfilePolicy(profile.timings),
        timeouts: copyTimeoutPolicy(profile.timeouts)
    };
}

function copyProfileConfig(profile: ProfileConfig): ProfileConfig {
    return isDefinedFamilyProfile(profile) ? copyDefinedFamilyProfile(profile) : copyBuiltinProfileConfig(profile);
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
        history: { ...config.history },
        loader: copyLoaderConfig(config.loader),
        outputRenderer: config.outputRenderer,
        profiles: copyProfilesConfig(config.profiles),
        reporters: copyReporters(config.reporters),
        runtimeStateDir: config.runtimeStateDir
    };
}
