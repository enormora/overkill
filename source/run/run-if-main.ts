import type { TestNode } from '../engine/test-node.ts';
import { formatRunnerErrorDiagnostics } from './command-line-command.ts';
import type { DirectEntrypointRunner } from './run.ts';
import {
    rootAnnotations,
    rootControls,
    rootTitle,
    selectedOutputRenderer,
    selectedReporters,
    type RunIfMainOptions
} from './run-if-main-options.ts';
import type { DirectProfileContext } from './run-if-main-profile.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

export type RunIfMain = (
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
) => Promise<void>;

type RunIfMainExitCode = number | string | null | undefined;

export type RunIfMainDependencies = {
    readonly currentWorkingDirectory: () => string;
    readonly readExitCode: () => RunIfMainExitCode;
    readonly resolveDirectProfile: (meta: Readonly<ImportMeta>, cwd: string) => Promise<DirectProfileContext>;
    readonly runDirectEntrypoint: DirectEntrypointRunner;
    readonly setExitCode: (exitCode: number) => void;
    readonly stderr: {
        readonly write: (chunk: string) => unknown;
    };
};

type DirectRunContext = DirectProfileContext & {
    readonly options: RunIfMainOptions | undefined;
    readonly testNode: TestNode;
};

const failureExitCodes = new Set<number | string | null | undefined>([ undefined, null, 0, '0' ]);

function shouldSetFailureExitCode(exitCode: RunIfMainExitCode): boolean {
    return failureExitCodes.has(exitCode);
}

function directRunRequest(context: DirectRunContext): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        coverage: false,
        debug: { mode: 'off', selectors: [] },
        execution: { mode: 'profile-default' },
        measureResourceUsage: null,
        order: 'seeded',
        paths: [ context.file ],
        profile: context.name,
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed: { value: null },
        selection: { kind: 'all' },
        shard: { index: 1, total: 1 },
        timingCollection: 'profile-default',
        verbose: false,
        workers: null
    };
}

async function directRunConfig(context: DirectRunContext): Promise<RunConfig> {
    const reporters = await selectedReporters(context.profile, context.config, context.options);

    return {
        loader: context.config.loader,
        outputRenderer: selectedOutputRenderer(context.config, context.options),
        profiles: {
            ...context.config.profiles,
            [context.name]: { ...context.profile, reporters }
        },
        reporters,
        runtimeStateDir: context.config.runtimeStateDir
    };
}

async function directRunCommand(context: DirectRunContext): Promise<RunCommand> {
    return {
        config: await directRunConfig(context),
        cwd: context.projectRoot,
        engine: { kind: 'default' },
        request: directRunRequest(context)
    };
}

type DirectEntrypointDelivery = Awaited<ReturnType<DirectEntrypointRunner>>;

function hasFailure(result: DirectEntrypointDelivery['result']): boolean {
    return result.summary.failed > 0 || result.runnerErrors.length > 0;
}

function writeUndeliveredErrors(
    errors: DirectEntrypointDelivery['undeliveredRunnerErrors'],
    dependencies: RunIfMainDependencies
): void {
    for (const diagnostic of formatRunnerErrorDiagnostics(errors)) {
        dependencies.stderr.write(`${diagnostic}\n`);
    }
}

async function executeDirectRun(context: DirectRunContext, dependencies: RunIfMainDependencies): Promise<void> {
    const delivery = await dependencies.runDirectEntrypoint(
        await directRunCommand(context),
        {
            kind: 'direct-entrypoint',
            root: {
                annotations: rootAnnotations(context.options),
                controls: rootControls(context.options),
                title: rootTitle(context.options, context.projectRoot)
            },
            testNode: context.testNode
        }
    );

    writeUndeliveredErrors(delivery.undeliveredRunnerErrors, dependencies);

    if (hasFailure(delivery.result) && shouldSetFailureExitCode(dependencies.readExitCode())) {
        dependencies.setExitCode(1);
    }
}

export function createRunIfMain(dependencies: RunIfMainDependencies): RunIfMain {
    return async function runIfMain(meta, testNode, options) {
        if (!meta.main) {
            return;
        }

        const profile = await dependencies.resolveDirectProfile(meta, dependencies.currentWorkingDirectory());

        await executeDirectRun({ ...profile, options, testNode }, dependencies);
    };
}
