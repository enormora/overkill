import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type {
    DryRunResult,
    MutantRunResult,
    TestRunner,
    TestRunnerCapabilities
} from '@stryker-mutator/api/test-runner';
import { ConfigError } from '../run/config.entry-point.ts';
import type { FrozenMicrotestPolicy } from '../run/run.entry-point.ts';
import { initializeMutationPolicy } from './mutation-policy-process.ts';
import { parseRunnerOptions } from './runner-options.ts';

export function createOverkillTestRunner(options: Readonly<Record<string, unknown>>): Required<TestRunner> {
    let initialization: Promise<FrozenMicrotestPolicy> | null = null;
    const controller = new AbortController();

    async function initializePolicy(): Promise<FrozenMicrotestPolicy> {
        const settings = parseRunnerOptions(options.overkill);
        return await initializeMutationPolicy({ cwd: process.cwd(), settings, signal: controller.signal });
    }

    return {
        capabilities(): TestRunnerCapabilities {
            throw new Error('@overkill-dev/stryker-runner: capabilities() is not implemented.');
        },
        async init(): Promise<void> {
            if (controller.signal.aborted) {
                throw new ConfigError('Stryker runner has been disposed.');
            }
            initialization = initialization ?? initializePolicy();
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
            try {
                await initialization;
            } catch {
            }
        }
    };
}

createOverkillTestRunner.inject = tokens(commonTokens.options);
