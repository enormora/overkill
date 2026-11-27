import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test-type-authoring';
import { sameType } from '@overkill-dev/type-test';
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

export const testNode = suite('ordinary baseline API', [
    test('uses explicit verbs and disk-only list commands', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof orchestrator.baseline.update, BaselineOperation>, true>());
        typeScope.assert(
            sameType<IsEqual<ReturnType<typeof orchestrator.baseline.update>, Promise<BaselineRunResult>>, true>()
        );
        typeScope.assert(sameType<IsEqual<typeof orchestrator.baseline.list, BaselineListOperation>, true>());
        typeScope.assert(
            sameType<
                Awaited<ReturnType<typeof orchestrator.baseline.list>>,
                readonly BaselineEntry<StoredOrdinaryBaseline>[]
            >()
        );
        typeScope.assert(sameType<Extract<keyof BaselineCommand['request'], 'baselineUpdateMode'>, never>());
        return typeScope.assert.collect();
    }),
    test('preserves typed observation, comparison, proposal, and codec boundaries', function (typeScope) {
        typeScope.assert(
            sameType<
                Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['toComparisonValue']>[0],
                Observation
            >()
        );
        typeScope.assert(
            sameType<Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['encode']>[0], Proposal>()
        );
        typeScope.assert(
            sameType<
                Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['decode']>[0],
                BaselinePayload
            >()
        );
        typeScope.assert(
            sameType<IsEqual<typeof defineBaselineAdapter<Observation, number, Proposal>, AdapterFactory>, true>()
        );
        return typeScope.assert.collect();
    })
]);
