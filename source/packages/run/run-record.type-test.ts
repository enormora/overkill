import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import type { FamilyRunFacts, ImplementationCatalog } from '../engine/engine.entry-point.ts';
import type { IsAssignable } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Run recording and replay metadata', [
    test('preserves implementation and family facts in version 1 records', function (scope) {
        scope.assert(sameType<IsEqual<RunFacts['family'], FamilyRunFacts>, true>());
        scope.assert(sameType<IsEqual<RunFacts['implementations'], ImplementationCatalog | null>, true>());
        scope.assert(sameType<IsEqual<RunRecord['version'], CurrentRecordVersion>, true>());
        scope.assert(sameType<IsEqual<RunRecord['facts'], VersionedFacts>, true>());
        scope.assert(sameType<IsEqual<SingleRunRecord['facts'], RunFacts | null>, true>());
        return scope.assert.collect();
    }),
    test('preserves merged record contracts', function (scope) {
        scope.assert(sameType<IsEqual<MergedRunRecord['version'], CurrentRecordVersion>, true>());
        scope.assert(sameType<IsEqual<MergedRunRecord['facts']['family'], FamilyRunFacts | null>, true>());
        return scope.assert.collect();
    }),
    test('exposes serializable run facts with case annotations and controls', function (scope) {
        scope.assert(sameType<IsEqual<keyof RunFacts, RunFactsKeys[number]>, true>());
        scope.assert(sameType<IsEqual<RunFacts['cases'][number]['annotations'], SerializedValue>, true>());
        scope.assert(sameType<IsEqual<RunFacts['cases'][number]['controls'], SerializedValue>, true>());
        scope.assert(sameType<IsEqual<RunFacts['reproducibility']['selection'], RunSelection>, true>());
        scope.assert(sameType<IsAssignable<RunFacts, Readonly<Record<string, unknown>>>, true>());
        return scope.assert.collect();
    }),
    test('exposes JSON-safe coverage run records with explicit absent facts and metadata', function (scope) {
        scope.assert(sameType<IsEqual<RunFacts['benchmarkPlacement'], BenchmarkPlacementFacts | null>, true>());
        scope.assert(sameType<IsEqual<RunFacts['coveragePolicy'], CoveragePolicy | null>, true>());
        scope.assert(sameType<IsEqual<RunRecordRequest['seed'], { readonly value: string; }>, true>());
        scope.assert(sameType<NonNullable<RunRecord['versions']>['engine'], string | null>());
        scope.assert(sameType<IsEqual<SingleRunRecord['runtime'], ResolvedRuntime | null>, true>());
        scope.assert(
            sameType<
                IsEqual<
                    Extract<RunRecord, { readonly status: 'completed'; }>['result'],
                    CompactRunResult | RunRecordResult
                >,
                true
            >()
        );
        scope.assert(sameType<IsEqual<RunRecordResult['runnerErrors'][number]['cause'], SerializedValue>, true>());
        return scope.assert.collect();
    })
]);
