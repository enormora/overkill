import { describe, expect, test } from 'tstyche';
import type { RunResult } from '../engine/engine.entry-point.ts';
import type {
    orchestrator,
    BenchmarkOrchestrator,
    FreezePolicyInput,
    FrozenMicrotestPolicy,
    FrozenRunCommand,
    ResolvedRun,
    RunCommand,
    RunInvocationOptions,
    RunInvocationTimingOptions,
    RunOrchestrator,
    RunReporterDeliveryResult
} from './run.entry-point.ts';

describe('public runner invocation', function () {
    test('preserves timing-only methods and adds supervised cancellation', function () {
        expect<typeof orchestrator>().type.toBe<RunOrchestrator>();
        expect<typeof orchestrator.freezePolicy>().type.toBe<
            (input: FreezePolicyInput) => Promise<FrozenMicrotestPolicy>
        >();
        expect<typeof orchestrator.resolve>().type.toBe<
            (command: FrozenRunCommand | RunCommand, options?: RunInvocationTimingOptions) => Promise<ResolvedRun>
        >();
        expect<typeof orchestrator.run>().type.toBe<
            (
                command: FrozenRunCommand | RunCommand,
                options?: RunInvocationOptions | RunInvocationTimingOptions
            ) => Promise<RunResult>
        >();
        expect<RunInvocationOptions>().type.toBe<
            RunInvocationTimingOptions & { readonly signal: AbortSignal | null; }
        >();
    });
    test('preserves benchmark invocation contracts', function () {
        expect<typeof orchestrator.bench>().type.toBe<BenchmarkOrchestrator>();
        expect<typeof orchestrator.bench.list>().type.toBe<
            (command: RunCommand, options: RunInvocationTimingOptions) => Promise<ResolvedRun>
        >();
        expect<typeof orchestrator.bench.run>().type.toBe<
            (command: RunCommand, options: RunInvocationTimingOptions) => Promise<RunResult>
        >();
        expect<typeof orchestrator.bench.runWithReporterDelivery>().type.toBe<
            (command: RunCommand, options: RunInvocationTimingOptions) => Promise<RunReporterDeliveryResult>
        >();
    });
});
