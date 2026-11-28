import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
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
    test('uses explicit verbs and disk-only list commands', function (scope) {
        scope.assert(sameType<IsEqual<typeof orchestrator.baseline.update, BaselineOperation>, true>());
        scope.assert(
            sameType<IsEqual<ReturnType<typeof orchestrator.baseline.update>, Promise<BaselineRunResult>>, true>()
        );
        scope.assert(sameType<IsEqual<typeof orchestrator.baseline.list, BaselineListOperation>, true>());
        scope.assert(
            sameType<
                IsEqual<
                    Awaited<ReturnType<typeof orchestrator.baseline.list>>,
                    readonly BaselineEntry<StoredOrdinaryBaseline>[]
                >,
                true
            >()
        );
        scope.assert(sameType<Extract<keyof BaselineCommand['request'], 'baselineUpdateMode'>, never>());
        return scope.assert.collect();
    }),
    test('preserves typed observation, comparison, proposal, and codec boundaries', function (scope) {
        scope.assert(
            sameType<
                IsEqual<
                    Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['toComparisonValue']>[0],
                    Observation
                >,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['encode']>[0], Proposal>,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<
                    Parameters<BaselineAdapterDefinition<Observation, number, Proposal>['decode']>[0],
                    BaselinePayload
                >,
                true
            >()
        );
        scope.assert(
            sameType<IsEqual<typeof defineBaselineAdapter<Observation, number, Proposal>, AdapterFactory>, true>()
        );
        return scope.assert.collect();
    })
]);
