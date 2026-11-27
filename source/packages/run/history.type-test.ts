import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { createHistory, History, HistoryOptions, HistoryClearRequest } from './run.entry-point.ts';
import type { Config } from './config.entry-point.ts';

export const testNode = suite('@overkill-dev/run history', [
    test('accepts project history retention settings', function (typeScope) {
        typeScope.assert(sameType<
            [{
                readonly history: {
                    readonly detailedRunLimit: number;
                    readonly successfulArtifactRunLimit: number;
                    readonly failingArtifactRetentionDays: number;
                };
            }] extends [Config] ? true : false,
            true
        >());
        return typeScope.assert.collect();
    }),
    test('exports a typed service requiring explicit confirmation for clear', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof createHistory, (options: HistoryOptions) => History>, true>());
        typeScope.assert(sameType<HistoryClearRequest, { readonly confirmed: true; }>());
        typeScope.assert(sameType<Parameters<History['prune']>[0], { readonly dryRun: boolean; }>());
        return typeScope.assert.collect();
    })
]);
