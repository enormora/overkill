import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { FamilyRunFacts, ImplementationCatalog } from '../engine/engine.entry-point.ts';
import { type IsAssignable } from '../../test-support/type-relations.ts';
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
        typeScope.assert(sameType<IsEqual<RunFacts['family'], FamilyRunFacts>, true>());
        typeScope.assert(sameType<IsEqual<RunFacts['implementations'], ImplementationCatalog | null>, true>());
        typeScope.assert(sameType<IsEqual<RunRecord['version'], CurrentRecordVersion>, true>());
        typeScope.assert(sameType<IsEqual<RunRecord['facts'], VersionedFacts>, true>());
        typeScope.assert(sameType<IsEqual<SingleRunRecord['facts'], RunFacts | null>, true>());
        return typeScope.assert.collect();
    }),
    test('preserves merged record contracts', function (typeScope) {
        typeScope.assert(sameType<IsEqual<MergedRunRecord['version'], CurrentRecordVersion>, true>());
        typeScope.assert(sameType<IsEqual<MergedRunRecord['facts']['family'], FamilyRunFacts | null>, true>());
        return typeScope.assert.collect();
    }),
    test('exposes serializable run facts with case annotations and controls', function (typeScope) {
        typeScope.assert(sameType<IsEqual<keyof RunFacts, RunFactsKeys[number]>, true>());
        typeScope.assert(sameType<IsEqual<RunFacts['cases'][number]['annotations'], SerializedValue>, true>());
        typeScope.assert(sameType<IsEqual<RunFacts['cases'][number]['controls'], SerializedValue>, true>());
        typeScope.assert(sameType<IsEqual<RunFacts['reproducibility']['selection'], RunSelection>, true>());
        typeScope.assert(sameType<IsAssignable<RunFacts, Readonly<Record<string, unknown>>>, true>());
        return typeScope.assert.collect();
    }),
    test('exposes JSON-safe coverage run records with explicit absent facts and metadata', function (typeScope) {
        typeScope.assert(sameType<IsEqual<RunFacts['benchmarkPlacement'], BenchmarkPlacementFacts | null>, true>());
        typeScope.assert(sameType<IsEqual<RunFacts['coveragePolicy'], CoveragePolicy | null>, true>());
        typeScope.assert(sameType<IsEqual<RunRecordRequest['seed'], { readonly value: string; }>, true>());
        typeScope.assert(sameType<NonNullable<RunRecord['versions']>['engine'], string | null>());
        typeScope.assert(sameType<IsEqual<SingleRunRecord['runtime'], ResolvedRuntime | null>, true>());
        typeScope.assert(
            sameType<
                IsEqual<
                    Extract<RunRecord, { readonly status: 'completed'; }>['result'],
                    CompactRunResult | RunRecordResult
                >,
                true
            >()
        );
        typeScope.assert(sameType<IsEqual<RunRecordResult['runnerErrors'][number]['cause'], SerializedValue>, true>());
        return typeScope.assert.collect();
    })
]);
