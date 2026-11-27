import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { snapshot as standardSnapshot, BaselineEntry as StandardEntry } from '../test/baselines.entry-point.ts';
import type { AssertReferenceArguments } from '../engine/assertion-protocol.entry-point.ts';
import { type IsAssignable } from '../../test-support/type-relations.ts';
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

export const testNode = suite('baselines', [
    test('exposes typed snapshot references through both facades', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof standardSnapshot, typeof snapshot>, true>());
        typeScope.assert(
            sameType<IsEqual<AssertReferenceArguments<typeof snapshot.text>, readonly [string, string]>, true>()
        );
        typeScope.assert(
            sameType<IsEqual<AssertReferenceArguments<typeof snapshot.bytes>, readonly [string, Uint8Array]>, true>()
        );
        typeScope.assert(
            sameType<IsAssignable<readonly [string, Date], AssertReferenceArguments<typeof snapshot.value>>, false>()
        );
        return typeScope.assert.collect();
    }),
    test('preserves performance defaults and supports subtype records', function (typeScope) {
        typeScope.assert(sameType<IsEqual<BaselineEntry['baseline'], StoredPerformanceBaseline>, true>());
        typeScope.assert(sameType<IsEqual<BaselineEntry<Uint8Array>['baseline'], Uint8Array>, true>());
        typeScope.assert(sameType<IsEqual<StandardEntry<string>, BaselineEntry<string>>, true>());
        typeScope.assert(
            sameType<
                IsEqual<Extract<BaselineChange, { readonly kind: 'remove'; }>['baseline'], StoredPerformanceBaseline>,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsEqual<
                    Extract<BaselineWriteOutcome<string>, { readonly kind: 'failed'; }>['writtenChanges'],
                    readonly BaselineChange<string>[]
                >,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsEqual<ReturnType<PerformanceBaselineAdapter['observe']>, BaselineObservation<BaselineJson>>,
                true
            >()
        );
        return typeScope.assert.collect();
    }),
    test('allows asynchronous binary adapters and requires mismatch diagnostics', function (typeScope) {
        type BinaryAdapter = BaselineAdapter<Uint8Array, Uint8Array, Uint8Array, Uint8Array, string>;
        typeScope.assert(
            sameType<
                IsAssignable<Promise<BaselineObservation<Uint8Array>>, ReturnType<BinaryAdapter['observe']>>,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsAssignable<
                    { readonly kind: 'mismatch'; readonly diagnostics: readonly []; },
                    BaselineComparison<string>
                >,
                false
            >()
        );
        return typeScope.assert.collect();
    })
]);
