import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { snapshot as standardSnapshot, BaselineEntry as StandardEntry } from '../test/baselines.entry-point.ts';
import type { AssertReferenceArguments } from '../engine/assertion-protocol.entry-point.ts';
import type { IsAssignable } from '../../test-support/type-relations.ts';
import type {
    snapshot,
    BaselineAdapter,
    BaselineJson,
    BaselineChange,
    BaselineComparison,
    BaselineEntry,
    BaselineObservation,
    BaselineWriteOutcome,
    PerformanceBaselineAdapter,
    StoredPerformanceBaseline
} from './baselines.entry-point.ts';

export const testNode = suite('Baseline declarations and mismatch outcomes', [
    test('exposes typed snapshot references through both facades', function (scope) {
        scope.assert(sameType<IsEqual<typeof standardSnapshot, typeof snapshot>, true>());
        scope.assert(
            sameType<IsEqual<AssertReferenceArguments<typeof snapshot.text>, readonly [string, string]>, true>()
        );
        scope.assert(
            sameType<IsEqual<AssertReferenceArguments<typeof snapshot.bytes>, readonly [string, Uint8Array]>, true>()
        );
        scope.assert(
            sameType<IsAssignable<readonly [string, Date], AssertReferenceArguments<typeof snapshot.value>>, false>()
        );
        return scope.assert.collect();
    }),
    test('preserves performance defaults and supports subtype records', function (scope) {
        scope.assert(sameType<IsEqual<BaselineEntry['baseline'], StoredPerformanceBaseline>, true>());
        scope.assert(sameType<IsEqual<BaselineEntry<Uint8Array>['baseline'], Uint8Array>, true>());
        scope.assert(sameType<IsEqual<StandardEntry<string>, BaselineEntry<string>>, true>());
        scope.assert(
            sameType<
                IsEqual<Extract<BaselineChange, { readonly kind: 'remove'; }>['baseline'], StoredPerformanceBaseline>,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<
                    Extract<BaselineWriteOutcome<string>, { readonly kind: 'failed'; }>['writtenChanges'],
                    readonly BaselineChange<string>[]
                >,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<ReturnType<PerformanceBaselineAdapter['observe']>, BaselineObservation<BaselineJson>>,
                true
            >()
        );
        return scope.assert.collect();
    }),
    test('allows asynchronous binary adapters and requires mismatch diagnostics', function (scope) {
        type BinaryAdapter = BaselineAdapter<Uint8Array, Uint8Array, Uint8Array, Uint8Array, string>;
        scope.assert(
            sameType<
                IsAssignable<Promise<BaselineObservation<Uint8Array>>, ReturnType<BinaryAdapter['observe']>>,
                true
            >()
        );
        scope.assert(
            sameType<
                IsAssignable<
                    { readonly kind: 'mismatch'; readonly diagnostics: readonly []; },
                    BaselineComparison<string>
                >,
                false
            >()
        );
        return scope.assert.collect();
    })
]);
