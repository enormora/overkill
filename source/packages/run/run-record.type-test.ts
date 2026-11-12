import type { Except } from 'type-fest';
import { describe, expect, test } from 'tstyche';
import type { FamilyRunFacts } from '../engine/engine.entry-point.ts';
import type {
    CoveragePolicy,
    BenchmarkPlacementFacts,
    RunFacts,
    RunSelection,
    SerializedValue,
    RunRecord,
    SingleRunRecord,
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
    'loader',
    'reproducibility'
];

type FamilyRecordVersion = 3;
type LegacyReplayRecordVersion = 2;
type LegacyRunFacts = Except<RunFacts, 'family'>;

describe('@overkill-dev/run recording', function () {
    test('separates family facts from historical record contracts', function () {
        expect<RunFacts['family']>().type.toBe<FamilyRunFacts>();
        expect<RunRecord['facts']>().type.toBe<LegacyRunFacts | RunFacts | null>();
        expect<Extract<RunRecord, { readonly version: FamilyRecordVersion; }>['facts']>()
            .type
            .toBe<RunFacts | null>();
        expect<Extract<RunRecord, { readonly version: LegacyReplayRecordVersion; }>['facts']>()
            .type
            .toBe<LegacyRunFacts | null>();
        expect<Extract<RunRecord, { readonly version: 1; }>['facts']>().type.toBe<LegacyRunFacts | null>();
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
        expect<RunRecord['versions']['engine']>().type.toBe<string | null>();
        expect<SingleRunRecord['runtime']>().type.toBe<ResolvedRuntime | null>();
        expect<Extract<RunRecord, { readonly status: 'completed'; }>['result']>().type.toBe<RunRecordResult>();
        expect<RunRecordResult['runnerErrors'][number]['cause']>().type.toBe<SerializedValue>();
    });
});
