import { describe, expect, test } from 'tstyche';
import type {
    RunCoveragePolicy,
    RunFacts,
    RunSelection,
    SerializedValue,
    RunRecord,
    RunRecordRequest,
    RunRecordResult,
    ResolvedRuntime
} from './run.entry-point.ts';

type RunFactsKeys = readonly [
    'cases',
    'coveragePolicy',
    'durationHistory',
    'environment',
    'execution',
    'loader',
    'reproducibility'
];

describe('@overkill-dev/run recording', function () {
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
        expect<RunFacts['coveragePolicy']>().type.toBe<RunCoveragePolicy | null>();
        expect<RunRecordRequest['seed']>().type.toBe<{ readonly value: string; }>();
        expect<RunRecord['facts']>().type.toBe<RunFacts | null>();
        expect<RunRecord['versions']['engine']>().type.toBe<string | null>();
        expect<RunRecord['runtime']>().type.toBe<ResolvedRuntime | null>();
        expect<Extract<RunRecord, { readonly status: 'completed'; }>['result']>().type.toBe<RunRecordResult>();
        expect<RunRecordResult['runnerErrors'][number]['cause']>().type.toBe<SerializedValue>();
    });
});
