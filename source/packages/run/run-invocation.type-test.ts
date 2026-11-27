import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test-type-authoring';
import { sameType } from '@overkill-dev/type-test';
import type {
    orchestrator,
    BenchmarkOrchestrator,
    FreezePolicyInput,
    FrozenMicrotestPolicy,
    ConfiguredRunCommand,
    FrozenRunCommand,
    ResolvedRun,
    RunCommandInput,
    RunInvocationOptions,
    RunInvocationTimingOptions,
    RunOrchestrator,
    RunReporterDeliveryResult,
    RunnerResult
} from './run.entry-point.ts';

export const testNode = suite('public runner invocation', [
    test('preserves timing-only methods and adds supervised cancellation', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof orchestrator, RunOrchestrator>, true>());
        typeScope.assert(
            sameType<
                IsEqual<typeof orchestrator.freezePolicy, (input: FreezePolicyInput) => Promise<FrozenMicrotestPolicy>>,
                true
            >()
        );
        typeScope.assert(sameType<
            IsEqual<
                typeof orchestrator.resolve,
                (
                    command: ConfiguredRunCommand | FrozenRunCommand | RunCommandInput,
                    options?: RunInvocationTimingOptions
                ) => Promise<ResolvedRun>
            >,
            true
        >());
        typeScope.assert(sameType<
            IsEqual<
                typeof orchestrator.run,
                (
                    command: ConfiguredRunCommand | FrozenRunCommand | RunCommandInput,
                    options?: RunInvocationOptions | RunInvocationTimingOptions
                ) => Promise<RunnerResult>
            >,
            true
        >());
        typeScope.assert(
            sameType<RunInvocationOptions, RunInvocationTimingOptions & { readonly signal: AbortSignal | null; }>()
        );
        return typeScope.assert.collect();
    }),
    test('preserves benchmark invocation contracts', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof orchestrator.bench, BenchmarkOrchestrator>, true>());
        typeScope.assert(
            sameType<
                IsEqual<
                    typeof orchestrator.bench.list,
                    (command: RunCommandInput, options: RunInvocationTimingOptions) => Promise<ResolvedRun>
                >,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsEqual<
                    typeof orchestrator.bench.run,
                    (command: RunCommandInput, options: RunInvocationTimingOptions) => Promise<RunnerResult>
                >,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsEqual<
                    typeof orchestrator.bench.runWithReporterDelivery,
                    (
                        command: RunCommandInput,
                        options: RunInvocationTimingOptions
                    ) => Promise<RunReporterDeliveryResult>
                >,
                true
            >()
        );
        return typeScope.assert.collect();
    })
]);
