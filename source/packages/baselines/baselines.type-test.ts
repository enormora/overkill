import { suite, test } from '@overkill-dev/test-type-authoring';
import { assignableTo, sameType } from '@overkill-dev/type-test';
import type { snapshot as standardSnapshot, BaselineEntry as StandardEntry } from '../test/baselines.entry-point.ts';
import type { AssertReferenceArguments } from '../engine/assertion-protocol.entry-point.ts';
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
        typeScope.assert(sameType<typeof standardSnapshot, typeof snapshot>());
        typeScope.assert(sameType<AssertReferenceArguments<typeof snapshot.text>, readonly [string, string]>());
        typeScope.assert(sameType<AssertReferenceArguments<typeof snapshot.bytes>, readonly [string, Uint8Array]>());
        typeScope.assert(assignableTo.not<readonly [string, Date], AssertReferenceArguments<typeof snapshot.value>>());
        return typeScope.assert.collect();
    }),
    test('preserves performance defaults and supports subtype records', function (typeScope) {
        typeScope.assert(sameType<BaselineEntry['baseline'], StoredPerformanceBaseline>());
        typeScope.assert(sameType<BaselineEntry<Uint8Array>['baseline'], Uint8Array>());
        typeScope.assert(sameType<StandardEntry<string>, BaselineEntry<string>>());
        typeScope.assert(
            sameType<Extract<BaselineChange, { readonly kind: 'remove'; }>['baseline'], StoredPerformanceBaseline>()
        );
        typeScope.assert(
            sameType<
                Extract<BaselineWriteOutcome<string>, { readonly kind: 'failed'; }>['writtenChanges'],
                readonly BaselineChange<string>[]
            >()
        );
        typeScope.assert(
            sameType<ReturnType<PerformanceBaselineAdapter['observe']>, BaselineObservation<BaselineJson>>()
        );
        return typeScope.assert.collect();
    }),
    test('allows asynchronous binary adapters and requires mismatch diagnostics', function (typeScope) {
        type BinaryAdapter = BaselineAdapter<Uint8Array, Uint8Array, Uint8Array, Uint8Array, string>;
        typeScope.assert(
            assignableTo<Promise<BaselineObservation<Uint8Array>>, ReturnType<BinaryAdapter['observe']>>()
        );
        typeScope.assert(
            assignableTo.not<
                { readonly kind: 'mismatch'; readonly diagnostics: readonly []; },
                BaselineComparison<string>
            >()
        );
        return typeScope.assert.collect();
    })
]);
