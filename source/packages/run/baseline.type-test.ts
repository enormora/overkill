import { describe, expect, test } from 'tstyche';
import type { BaselineEntry } from '../baselines/baselines.entry-point.ts';
import type {
    orchestrator,
    BaselineCommand,
    BaselineListCommand,
    RunInvocationOptions,
    RunInvocationTimingOptions,
    BaselineRunResult,
    BaselineAdapterDefinition,
    BaselinePayload,
    OrdinaryBaselineAdapter,
    StoredOrdinaryBaseline,
    defineBaselineAdapter
} from './run.entry-point.ts';

type Observation = { readonly count: number; };
type Proposal = readonly number[];
type BaselineOperation = (
    command: BaselineCommand,
    options: RunInvocationOptions | RunInvocationTimingOptions
) => Promise<BaselineRunResult>;
type BaselineListOperation = (
    command: BaselineListCommand
) => Promise<readonly BaselineEntry<StoredOrdinaryBaseline>[]>;
type AdapterFactory = (definition: BaselineAdapterDefinition<Observation, number, Proposal>) => OrdinaryBaselineAdapter;
describe('ordinary baseline API', function () {
    test('uses explicit verbs and disk-only list commands', function () {
        expect<typeof orchestrator.baseline.update>().type.toBe<BaselineOperation>();
        expect<ReturnType<typeof orchestrator.baseline.update>>().type.toBe<Promise<BaselineRunResult>>();
        expect<typeof orchestrator.baseline.list>().type.toBe<BaselineListOperation>();
        expect<Awaited<ReturnType<typeof orchestrator.baseline.list>>>().type.toBe<
            readonly BaselineEntry<StoredOrdinaryBaseline>[]
        >();
        expect<Extract<keyof BaselineCommand['request'], 'baselineUpdateMode'>>().type.toBe<never>();
    });
    test('preserves typed observation, comparison, proposal, and codec boundaries', function () {
        expect<Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['toComparisonValue']>[0]>()
            .type
            .toBe<Observation>();
        expect<Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['encode']>[0]>().type.toBe<
            Proposal
        >();
        expect<Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['decode']>[0]>().type.toBe<
            BaselinePayload
        >();
        expect<typeof defineBaselineAdapter<Observation, number, Proposal>>().type.toBe<AdapterFactory>();
    });
});
