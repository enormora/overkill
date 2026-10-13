import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type { FileDescriptions } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import type {
    DryRunResult,
    MutantRunResult,
    TestRunner,
    TestRunnerCapabilities
} from '@stryker-mutator/api/test-runner';
import { ConfigError } from '../run/config.entry-point.ts';
import { createMutationExecution, type MutationExecution } from './mutation-execution.ts';
import { initializeMutationPolicy } from './mutation-policy-process.ts';
import { parseRunnerOptions } from './runner-options.ts';
import { assertExcludedAdapter, createMutationSandbox } from './mutation-sandbox.ts';

const originalRoot = process.cwd();

export function createOverkillTestRunner(
    options: Readonly<Record<string, unknown>>,
    fileDescriptions: FileDescriptions,
    logger: Readonly<Pick<Logger, 'info'>>
): Required<TestRunner> {
    let initialization: Promise<MutationExecution> | null = null;
    const controller = new AbortController();

    async function initializeExecution(): Promise<MutationExecution> {
        const settings = parseRunnerOptions(options.overkill);
        logger.info('Overkill campaign seed: %s', settings.seed);
        const sandbox = await createMutationSandbox({ originalRoot, cwd: process.cwd(), fileDescriptions });
        await assertExcludedAdapter(sandbox);
        const policy = await initializeMutationPolicy({
            cwd: sandbox.root,
            sandbox,
            settings,
            signal: controller.signal
        });
        return createMutationExecution({
            policy,
            seed: { value: BigInt(settings.seed) },
            freshState: settings.freshState
        });
    }

    return {
        capabilities(): TestRunnerCapabilities {
            throw new Error('@overkill-dev/stryker-runner: capabilities() is not implemented.');
        },
        async init(): Promise<void> {
            if (controller.signal.aborted) {
                throw new ConfigError('Stryker runner has been disposed.');
            }
            initialization = initialization ?? initializeExecution();
            await initialization;
        },
        async dryRun(): Promise<DryRunResult> {
            throw new Error('@overkill-dev/stryker-runner: dryRun() is not implemented.');
        },
        async mutantRun(): Promise<MutantRunResult> {
            throw new Error('@overkill-dev/stryker-runner: mutantRun() is not implemented.');
        },
        async dispose(): Promise<void> {
            controller.abort();
            let execution: MutationExecution | null = null;
            try {
                execution = await initialization;
            } catch {
            }
            await execution?.dispose();
        }
    };
}

createOverkillTestRunner.inject = tokens(commonTokens.options, commonTokens.fileDescriptions, commonTokens.logger);
