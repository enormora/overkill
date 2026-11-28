import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { createHistory, History, HistoryOptions, HistoryClearRequest } from './run.entry-point.ts';
import type { Config } from './config.entry-point.ts';

export const testNode = suite('Run history records', [
    test('accepts project history retention settings', function (scope) {
        scope.assert(sameType<
            [{
                readonly history: {
                    readonly detailedRunLimit: number;
                    readonly successfulArtifactRunLimit: number;
                    readonly failingArtifactRetentionDays: number;
                };
            }] extends [Config] ? true : false,
            true
        >());
        return scope.assert.collect();
    }),
    test('exports a typed service requiring explicit confirmation for clear', function (scope) {
        scope.assert(sameType<IsEqual<typeof createHistory, (options: HistoryOptions) => History>, true>());
        scope.assert(sameType<IsEqual<HistoryClearRequest, { readonly confirmed: true; }>, true>());
        scope.assert(sameType<IsEqual<Parameters<History['prune']>[0], { readonly dryRun: boolean; }>, true>());
        return scope.assert.collect();
    })
]);
