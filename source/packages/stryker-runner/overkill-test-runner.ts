import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type {
    DryRunResult,
    MutantRunResult,
    TestRunner,
    TestRunnerCapabilities
} from '@stryker-mutator/api/test-runner';
import { loadConfig } from '../run/config.entry-point.ts';
import type { RunCommand } from '../run/run.entry-point.ts';
import { selectMicrotestProfile } from './microtest-profile.ts';
import { createMutationRunCommand } from './mutation-execution-policy.ts';
import { parseRunnerOptions } from './runner-options.ts';

export function createOverkillTestRunner(options: Readonly<Record<string, unknown>>): Required<TestRunner> {
    let initialization: Promise<RunCommand> | null = null;

    async function initializeRunCommand(): Promise<RunCommand> {
        const settings = parseRunnerOptions(options.overkill);
        const cwd = process.cwd();
        const config = await loadConfig({ configPath: settings.configPath, cwd });

        const selected = selectMicrotestProfile(config, settings.profile);

        return createMutationRunCommand({ config, cwd, profile: selected.name });
    }

    return {
        capabilities(): TestRunnerCapabilities {
            throw new Error('@overkill-dev/stryker-runner: capabilities() is not implemented.');
        },
        async init(): Promise<void> {
            initialization = initialization ?? initializeRunCommand();
            await initialization;
        },
        async dryRun(): Promise<DryRunResult> {
            throw new Error('@overkill-dev/stryker-runner: dryRun() is not implemented.');
        },
        async mutantRun(): Promise<MutantRunResult> {
            throw new Error('@overkill-dev/stryker-runner: mutantRun() is not implemented.');
        },
        async dispose(): Promise<void> {
            await Promise.resolve();
        }
    };
}

createOverkillTestRunner.inject = tokens(commonTokens.options);
