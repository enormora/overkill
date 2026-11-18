import { describe, expect, test } from 'tstyche';
import type { FamilyRunFacts, ImplementationCatalog } from '../engine/engine.entry-point.ts';
import type {
    CoveragePolicy,
    BenchmarkPlacementFacts,
    RunFacts,
    RunSelection,
    SerializedValue,
    RunRecord,
    CompactRunRecord,
    CompactRunResult,
    SingleRunRecord,
    MergedRunRecord,
    RunRecordRequest,
    RunRecordResult,
    ResolvedRuntime
} from './run.entry-point.ts';

type RunFactsKeys = readonly [
    'adapter',
    'benchmarkHost',
    'benchmarkPlacement',
    'benchmarkCalibration',
    'benchmarkNormalization',
    'cases',
    'coveragePolicy',
    'durationHistory',
    'environment',
    'execution',
    'family',
    'implementations',
    'loader',
    'reproducibility'
];

type CurrentRecordVersion = 1;
type VersionedFacts = CompactRunRecord['facts'] | MergedRunRecord['facts'] | RunFacts | null;

describe('@overkill-dev/run recording', function () {
    test('preserves implementation and family facts in version 1 records', function () {
        expect<RunFacts['family']>().type.toBe<FamilyRunFacts>();
        expect<RunFacts['implementations']>().type.toBe<ImplementationCatalog | null>();
        expect<RunRecord['version']>().type.toBe<CurrentRecordVersion>();
        expect<RunRecord['facts']>().type.toBe<VersionedFacts>();
        expect<SingleRunRecord['facts']>().type.toBe<RunFacts | null>();
    });
    test('preserves merged record contracts', function () {
        expect<MergedRunRecord['version']>().type.toBe<CurrentRecordVersion>();
        expect<MergedRunRecord['facts']['family']>().type.toBe<FamilyRunFacts | null>();
    });
    test('exposes serializable run facts with case annotations and controls', function () {
        expect<keyof RunFacts>()
            .type
            .toBe<RunFactsKeys[number]>();
        expect<RunFacts['cases'][number]['annotations']>().type.toBe<SerializedValue>();
        expect<RunFacts['cases'][number]['controls']>().type.toBe<SerializedValue>();
        expect<RunFacts['reproducibility']['selection']>().type.toBe<RunSelection>();
        expect<RunFacts>().type.toBeAssignableTo<Readonly<Record<string, unknown>>>();
    });

    test('exposes JSON-safe coverage run records with explicit absent facts and metadata', function () {
        expect<RunFacts['benchmarkPlacement']>().type.toBe<BenchmarkPlacementFacts | null>();
        expect<RunFacts['coveragePolicy']>().type.toBe<CoveragePolicy | null>();
        expect<RunRecordRequest['seed']>().type.toBe<{ readonly value: string; }>();
        expect<NonNullable<RunRecord['versions']>['engine']>().type.toBe<string | null>();
        expect<SingleRunRecord['runtime']>().type.toBe<ResolvedRuntime | null>();
        expect<Extract<RunRecord, { readonly status: 'completed'; }>['result']>()
            .type
            .toBe<CompactRunResult | RunRecordResult>();
        expect<RunRecordResult['runnerErrors'][number]['cause']>().type.toBe<SerializedValue>();
    });
});
