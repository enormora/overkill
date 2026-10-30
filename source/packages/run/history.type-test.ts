import { describe, expect, test } from 'tstyche';
import type { createHistory, History, HistoryOptions, HistoryClearRequest } from './run.entry-point.ts';
import type { Config } from './config.entry-point.ts';

describe('@overkill-dev/run history', function () {
    test('accepts project history retention settings', function () {
        expect<Config>().type.toBeAssignableFrom<{
            readonly history: {
                readonly detailedRunLimit: number;
                readonly successfulArtifactRunLimit: number;
                readonly failingArtifactRetentionDays: number;
            };
        }>();
    });
    test('exports a typed service requiring explicit confirmation for clear', function () {
        expect<typeof createHistory>().type.toBe<(options: HistoryOptions) => History>();
        expect<HistoryClearRequest>().type.toBe<{ readonly confirmed: true; }>();
        expect<Parameters<History['prune']>[0]>().type.toBe<{ readonly dryRun: boolean; }>();
    });
});
