import type { WallClock } from '@enormora/wall-clock';
import type { Execute, ExecuteOptions } from './execution.ts';
import type { Reporter, RunFacts } from './reporter.ts';
import type { RunResult } from './run-result.ts';
import type { TestNode } from './test-node.ts';
import type { TestPlanFactory } from './test-plan.ts';

export type RunIfMainOptions = {
    readonly reporters?: readonly Reporter[];
    readonly runFacts?: RunFacts;
};

export type RunIfMain = (
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
) => Promise<void>;

export type RunIfMainDependencies = {
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

function createExecuteOptions(
    options: RunIfMainOptions | undefined,
    dependencies: RunIfMainDependencies
): ExecuteOptions {
    const startedAt = new Date(dependencies.wallClock.currentTimestampInMilliseconds);

    return {
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
            dependencies.createTestPlan(testNode),
            createExecuteOptions(options, dependencies)
        );

        if (hasFailure(result) && shouldSetFailureExitCode(dependencies.readExitCode())) {
            dependencies.writeExitCode(1);
        }
    };
}
