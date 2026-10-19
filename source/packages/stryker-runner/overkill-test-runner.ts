import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type { FileDescriptions } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { DryRunStatus, MutantRunStatus, type TestRunner } from '@stryker-mutator/api/test-runner';
import { createMutationRunnerLifecycle } from './mutation-runner-lifecycle.ts';
import { createMutationBaseline } from './mutation-baseline.ts';
import { createMutationRunnerInvocations } from './mutation-runner-invocations.ts';
import { expiredMutantResult } from './mutation-results.ts';

export function createOverkillTestRunner(
    options: Readonly<Record<string, unknown>>,
    fileDescriptions: FileDescriptions,
    logger: Readonly<Pick<Logger, 'info'>>
): Required<TestRunner> {
    const lifecycle = createMutationRunnerLifecycle(options, fileDescriptions, logger);
    const invocations = createMutationRunnerInvocations(createMutationBaseline(), options.ignoreStatic === true);
    return {
        async capabilities() {
            const runner = await lifecycle.ready(null);
            return { reloadEnvironment: runner.execution.environmentLifetime === 'fresh' };
        },
        async init() {
            await lifecycle.ready(null);
        },
        async dryRun(input) {
            try {
                return await lifecycle.invoke(
                    input.timeout,
                    async function (runner, budget) {
                        return await invocations.dry(runner, input, budget);
                    },
                    function () {
                        return { status: DryRunStatus.Timeout, reason: 'Dry run exceeded its deadline.' };
                    }
                );
            } catch (error: unknown) {
                return { status: DryRunStatus.Error, errorMessage: String(error) };
            }
        },
        async mutantRun(input) {
            try {
                return await lifecycle.invoke(
                    input.timeout,
                    async function (runner, budget) {
                        return await invocations.mutant(runner, input, budget);
                    },
                    expiredMutantResult
                );
            } catch (error: unknown) {
                return { status: MutantRunStatus.Error, errorMessage: String(error) };
            }
        },
        dispose: lifecycle.dispose
    };
}
createOverkillTestRunner.inject = tokens(commonTokens.options, commonTokens.fileDescriptions, commonTokens.logger);
