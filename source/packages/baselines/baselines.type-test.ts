import { expect, test } from 'tstyche';
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

test('exposes typed snapshot references through both facades', function () {
    expect<typeof standardSnapshot>().type.toBe<typeof snapshot>();
    expect<AssertReferenceArguments<typeof snapshot.text>>().type.toBe<readonly [string, string]>();
    expect<AssertReferenceArguments<typeof snapshot.bytes>>().type.toBe<readonly [string, Uint8Array]>();
    expect<readonly [string, Date]>().type.not.toBeAssignableTo<AssertReferenceArguments<typeof snapshot.value>>();
});

test('preserves performance defaults and supports subtype records', function () {
    expect<BaselineEntry['baseline']>().type.toBe<StoredPerformanceBaseline>();
    expect<BaselineEntry<Uint8Array>['baseline']>().type.toBe<Uint8Array>();
    expect<StandardEntry<string>>().type.toBe<BaselineEntry<string>>();
    expect<Extract<BaselineChange, { readonly kind: 'remove'; }>['baseline']>().type.toBe<StoredPerformanceBaseline>();
    expect<Extract<BaselineWriteOutcome<string>, { readonly kind: 'failed'; }>['writtenChanges']>()
        .type
        .toBe<readonly BaselineChange<string>[]>();
    expect<ReturnType<PerformanceBaselineAdapter['observe']>>().type.toBe<
        BaselineObservation<BaselineJson>
    >();
});
test('allows asynchronous binary adapters and requires mismatch diagnostics', function () {
    type BinaryAdapter = BaselineAdapter<Uint8Array, Uint8Array, Uint8Array, Uint8Array, string>;
    expect<Promise<BaselineObservation<Uint8Array>>>().type.toBeAssignableTo<ReturnType<BinaryAdapter['observe']>>();
    expect<{ readonly kind: 'mismatch'; readonly diagnostics: readonly []; }>().type.not.toBeAssignableTo<
        BaselineComparison<string>
    >();
});
