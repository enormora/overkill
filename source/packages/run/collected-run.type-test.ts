import { describe, expect, test } from 'tstyche';
import type { RunResult } from '../engine/engine.entry-point.ts';
import type {
    orchestrator,
    RunCommand,
    FrozenRunCommand,
    InitializedRun,
    CollectedRun,
    CollectedRunInvocation,
    RunSelection,
    RunCollectionError,
    parseRunResult,
    parseRunSelection,
    parseRunnerError,
    createRandomRunSeed,
    RunReporterDeliveryResult
} from './run.entry-point.ts';

describe('public runner lifecycle', function () {
    test('exposes typed transport parsers and seed generation', function () {
        expect<typeof parseRunResult>().type.toBe<(value: unknown) => RunResult>();
        expect<typeof parseRunSelection>().type.toBe<(value: unknown) => RunSelection>();
        expect<typeof parseRunnerError>().type.toBe<(value: unknown) => RunResult['runnerErrors'][number]>();
        expect<typeof createRandomRunSeed>().type.toBe<() => bigint>();
    });
    test('exposes initialization and collected execution', function () {
        expect<typeof orchestrator.initialize>().type.toBe<
            (command: FrozenRunCommand | RunCommand) => Promise<InitializedRun>
        >();
        expect<InitializedRun['collect']>().type.toBe<() => Promise<CollectedRun>>();
        expect<CollectedRunInvocation>().type.toBe<{ readonly selection: RunSelection; }>();
        expect<CollectedRun['run']>().type.toBe<(invocation: CollectedRunInvocation) => Promise<RunResult>>();
        expect<CollectedRun['runWithReporterDelivery']>().type.toBe<
            (invocation: CollectedRunInvocation) => Promise<RunReporterDeliveryResult>
        >();
        expect<RunCollectionError['runnerErrors']>().type.toBe<() => readonly RunResult['runnerErrors'][number][]>();
    });
    test('rejects invocation policy overrides', function () {
        expect<CollectedRun['run']>().type.not.toBeCallableWith({ selection: { kind: 'all' }, runtimePolicy: null });
        expect<CollectedRun['run']>().type.not.toBeCallableWith({ selection: { kind: 'all' }, coverage: true });
    });
});
