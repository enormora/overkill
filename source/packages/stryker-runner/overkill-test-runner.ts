import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type {
    DryRunResult,
    MutantRunResult,
    TestRunner,
    TestRunnerCapabilities
} from '@stryker-mutator/api/test-runner';
import { loadConfig, type LoadedConfig } from '../run/config.entry-point.ts';
import { selectMicrotestProfile, type SelectedMicrotestProfile } from './microtest-profile.ts';
import { parseRunnerOptions } from './runner-options.ts';

type InitializedProfile = SelectedMicrotestProfile & {
    readonly config: LoadedConfig;
    readonly cwd: string;
};

export function createOverkillTestRunner(options: Readonly<Record<string, unknown>>): Required<TestRunner> {
    let initialization: Promise<InitializedProfile> | null = null;

    async function initializeProfile(): Promise<InitializedProfile> {
        const settings = parseRunnerOptions(options.overkill);
        const cwd = process.cwd();
        const config = await loadConfig({ configPath: settings.configPath, cwd });

        return { ...selectMicrotestProfile(config, settings.profile), config, cwd };
    }

    return {
        capabilities(): TestRunnerCapabilities {
            throw new Error('@overkill-dev/stryker-runner: capabilities() is not implemented.');
        },
        async init(): Promise<void> {
            initialization = initialization ?? initializeProfile();
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
