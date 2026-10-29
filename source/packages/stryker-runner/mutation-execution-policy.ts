import type { RunCommand } from '../run/run.entry-point.ts';

export function createMutationRunCommand(
    input: Pick<RunCommand, 'config' | 'cwd'> & { readonly profile: string; }
): RunCommand {
    return {
        config: input.config,
        cwd: input.cwd,
        engine: { kind: 'default' },
        request: {
            baselineUpdateMode: 'none',
            capabilityRestrictions: { mode: 'enabled' },
            capture: 'buffered',
            record: false,
            coverage: false,
            debug: { mode: 'off', selectors: [] },
            execution: { mode: 'serial' },
            measureProcessUsage: null,
            order: 'seeded',
            paths: [],
            profile: input.profile,
            processBudgetOverrides: null,
            processUsageSamplingIntervalMilliseconds: null,
            seed: { value: null },
            selection: { kind: 'all' },
            shard: { index: 1, total: 1 },
            timingCollection: 'profile-default',
            verbose: false,
            workers: null
        }
    };
}
