import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { assignableTo, sameType } from '@overkill-dev/type-test';
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

export const testNode = suite('@overkill-dev/run recording', [
    test('preserves implementation and family facts in version 1 records', function (typeScope) {
        typeScope.assert(sameType<RunFacts['family'], FamilyRunFacts>());
        typeScope.assert(sameType<RunFacts['implementations'], ImplementationCatalog | null>());
        typeScope.assert(sameType<RunRecord['version'], CurrentRecordVersion>());
        typeScope.assert(sameType<RunRecord['facts'], VersionedFacts>());
        typeScope.assert(sameType<SingleRunRecord['facts'], RunFacts | null>());
        return typeScope.assert.collect();
    }),
    test('preserves merged record contracts', function (typeScope) {
        typeScope.assert(sameType<MergedRunRecord['version'], CurrentRecordVersion>());
        typeScope.assert(sameType<MergedRunRecord['facts']['family'], FamilyRunFacts | null>());
        return typeScope.assert.collect();
    }),
    test('exposes serializable run facts with case annotations and controls', function (typeScope) {
        typeScope.assert(sameType<keyof RunFacts, RunFactsKeys[number]>());
        typeScope.assert(sameType<RunFacts['cases'][number]['annotations'], SerializedValue>());
        typeScope.assert(sameType<RunFacts['cases'][number]['controls'], SerializedValue>());
        typeScope.assert(sameType<RunFacts['reproducibility']['selection'], RunSelection>());
        typeScope.assert(assignableTo<RunFacts, Readonly<Record<string, unknown>>>());
        return typeScope.assert.collect();
    }),
    test('exposes JSON-safe coverage run records with explicit absent facts and metadata', function (typeScope) {
        typeScope.assert(sameType<RunFacts['benchmarkPlacement'], BenchmarkPlacementFacts | null>());
        typeScope.assert(sameType<RunFacts['coveragePolicy'], CoveragePolicy | null>());
        typeScope.assert(sameType<RunRecordRequest['seed'], { readonly value: string; }>());
        typeScope.assert(sameType<NonNullable<RunRecord['versions']>['engine'], string | null>());
        typeScope.assert(sameType<SingleRunRecord['runtime'], ResolvedRuntime | null>());
        typeScope.assert(
            sameType<
                IsEqual<
                    Extract<RunRecord, { readonly status: 'completed'; }>['result'],
                    CompactRunResult | RunRecordResult
                >,
                true
            >()
        );
        typeScope.assert(sameType<RunRecordResult['runnerErrors'][number]['cause'], SerializedValue>());
        return typeScope.assert.collect();
    })
]);
