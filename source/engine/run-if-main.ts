import type { WallClock } from '@enormora/wall-clock';
import type { Execute, ExecuteOptions } from './execution.ts';
import { createPlainOutputRenderer, type OutputRenderer } from './reporter-output.ts';
import type { Reporter, RunFacts } from './reporter.ts';
import type { RunResult } from './run-result.ts';
import type { Metadata, RootOptions, TestNode, TestRoot } from './test-node.ts';
import type { TestPlanFactory } from './test-plan.ts';

export type RunIfMainOptions = {
    readonly outputRenderer?: OutputRenderer;
    readonly reporters?: readonly Reporter[];
    readonly root?: RunIfMainRootOptions;
    readonly runFacts?: RunFacts;
};

export type RunIfMainRootOptions = {
    readonly metadata: Metadata;
    readonly name: string;
};

export type RunIfMain = (
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
) => Promise<void>;

export type RunIfMainDependencies = {
    readonly createRoot: (options: RootOptions) => TestRoot;
    readonly createTestPlan: TestPlanFactory;
    readonly execute: Execute;
    readonly nodeVersion: string;
    readonly readExitCode: () => number | string | null | undefined;
    readonly wallClock: WallClock;
    readonly writeExitCode: (exitCode: number) => void;
};

const failureExitCodes = new Set<number | string | null | undefined>([ undefined, null, 0, '0' ]);

function shouldSetFailureExitCode(exitCode: number | string | null | undefined): boolean {
    return failureExitCodes.has(exitCode);
}

function hasFailure(result: RunResult): boolean {
    return result.summary.failed > 0 || result.runnerErrors.length > 0;
}

function rootMetadata(options: RunIfMainOptions | undefined): Metadata {
    return options?.root?.metadata ?? {};
}

function rootName(meta: Readonly<ImportMeta>, options: RunIfMainOptions | undefined): string {
    return options?.root?.name ?? meta.url;
}

function createRootOptions(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options: RunIfMainOptions | undefined
): RootOptions {
    return {
        children: [ testNode ],
        metadata: rootMetadata(options),
        name: rootName(meta, options)
    };
}

function createExecuteOptions(
    options: RunIfMainOptions | undefined,
    dependencies: RunIfMainDependencies
): ExecuteOptions {
    const startedAt = new Date(dependencies.wallClock.currentTimestampInMilliseconds);

    return {
        execution: { mode: 'serial-in-process' },
        outputRenderer: options?.outputRenderer ?? createPlainOutputRenderer(),
        reporters: options?.reporters ?? [],
        runFacts: {
            ...options?.runFacts,
            nodeVersion: dependencies.nodeVersion
        },
        startedAt: startedAt.toISOString()
    };
}

export function createRunIfMain(dependencies: RunIfMainDependencies): RunIfMain {
    return async function runIfMain(meta, testNode, options) {
        if (!meta.main) {
            return;
        }

        const result = await dependencies.execute(
            dependencies.createTestPlan(dependencies.createRoot(createRootOptions(meta, testNode, options))),
            createExecuteOptions(options, dependencies)
        );

        if (hasFailure(result) && shouldSetFailureExitCode(dependencies.readExitCode())) {
            dependencies.writeExitCode(1);
        }
    };
}
