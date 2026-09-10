import { glob, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createWallClock } from '@enormora/wall-clock';
import { createDirectRuntimePolicy } from '../../run/direct-runtime-policy.ts';
import { defaultRunEngine } from '../../run/default-run-engine.ts';
import { createRunIfMain } from '../../run/run-if-main.ts';
import { createDirectProfileResolver } from '../../run/run-if-main-profile.ts';
import { createNodeResourceUsageTracker } from '../../run/resource-usage.ts';
import { loadRunConfig } from './config.entry-point.ts';

const resolveDirectProfile = createDirectProfileResolver({
    fileURLToPath,
    glob,
    loadRunConfig,
    realpath,
    stat
});

export const runIfMain = createRunIfMain({
    createResourceUsageTracker: createNodeResourceUsageTracker,
    createRuntimePolicy: createDirectRuntimePolicy,
    createWallClock,
    currentWorkingDirectory() {
        return process.cwd();
    },
    readExitCode() {
        return process.exitCode;
    },
    resolveDirectProfile,
    runEngine: defaultRunEngine,
    setExitCode(exitCode) {
        process.exitCode = exitCode;
    },
    stderr: process.stderr
});

export { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
export {
    defineConfig,
    loadRunConfig,
    RunConfigError
} from './config.entry-point.ts';
export { RunResolutionError } from '../../run/run-errors.ts';
export type {
    LoadedRunConfig,
    RunConfigLoader,
    RunConfigLoaderDependencies,
    RunConfigLoadRequest,
    RunProjectConfig,
    RunProjectIntegrationExecution,
    RunProjectIntegrationProfileConfig,
    RunProjectMeasuredResourceUsage,
    RunProjectMicrotestExecution,
    RunProjectMicrotestProfileConfig,
    RunProjectProfileFiles,
    RunProjectProfileConfig,
    RunProjectProfilesConfig,
    RunProjectResourceBudgets,
    RunProjectResourceUsageConfig,
    RunProjectTimeoutConfig,
    RunProjectUnmeasuredResourceUsage
} from '../../run/run-config.ts';
export type {
    RunIfMain,
    RunIfMainDependencies
} from '../../run/run-if-main.ts';
export type {
    RunIfMainProfileResolver,
    RunIfMainProfileResolverDependencies
} from '../../run/run-if-main-profile.ts';
export type {
    RunIfMainOptions,
    RunIfMainRootOptions
} from '../../run/run-if-main-options.ts';
export type { RunResolutionErrorCode } from '../../run/run-errors.ts';
export type {
    CollectedRunCase,
    CollectedRunFile,
    CollectedRunPlan,
    ResolvedRun,
    ResolvedRunPlan,
    RunCaseFacts,
    RunCommand,
    RunConfig,
    RunDebugRequest,
    RunEngineFacts,
    RunEngineSelection,
    RunEnvironmentFacts,
    RunExecutionRequest,
    RunFacts,
    RunFilter,
    RunExecutionFacts,
    RunIntegrationExecution,
    RunIntegrationProfileConfig,
    RunLoaderConfig,
    RunMicrotestExecution,
    RunMicrotestProfileConfig,
    RunOrder,
    RunOrchestrator,
    RunProcessModel,
    RunProfileConfig,
    RunProfileFiles,
    RunProfilesConfig,
    RunResourceBudgets,
    RunResourceUsagePolicy,
    RunReproducibilityFacts,
    RunRequest,
    RunScheduling,
    RunSeed,
    RunSelection,
    RunShard,
    RunStringFilterField,
    RunTestFamily,
    RunTimeoutPolicy,
    SerializedValue
} from '../../run/run-types.ts';
