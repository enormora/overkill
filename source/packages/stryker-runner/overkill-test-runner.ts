import type {
    DryRunResult,
    MutantRunResult,
    TestRunner,
    TestRunnerCapabilities
} from '@stryker-mutator/api/test-runner';

export function createOverkillTestRunner(): Required<TestRunner> {
    return {
        capabilities(): TestRunnerCapabilities {
            throw new Error('@overkill-dev/stryker-runner: capabilities() is not implemented.');
        },
        async init(): Promise<void> {
            throw new Error('@overkill-dev/stryker-runner: init() is not implemented.');
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
