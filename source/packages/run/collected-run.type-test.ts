import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
import type { RunReport, RunResult } from '../engine/engine.entry-point.ts';
import type {
    orchestrator,
    RunCommandInput,
    ConfiguredRunCommand,
    FrozenRunCommand,
    InitializedRun,
    CollectedRun,
    CollectedRunInvocation,
    RunSelection,
    RunCollectionError,
    parseRunResult,
    parseRunnerResult,
    parseRunSelection,
    parseRunnerError,
    createRandomRunSeed,
    RunReporterDeliveryResult,
    RunnerResult
} from './run.entry-point.ts';

declare const callUnderTest: CollectedRun['run'];

export const testNode = suite('public runner lifecycle', [
    test('exposes typed transport parsers and seed generation', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof parseRunResult, (value: unknown) => RunResult>, true>());
        typeScope.assert(sameType<IsEqual<typeof parseRunnerResult, (value: unknown) => RunnerResult>, true>());
        typeScope.assert(sameType<
            IsEqual<
                RunnerResult,
                RunResult & {
                    readonly context: RunReport['context'];
                    readonly maintenanceDiagnostics: readonly string[];
                }
            >,
            true
        >());
        typeScope.assert(sameType<typeof parseRunSelection, (value: unknown) => RunSelection>());
        typeScope.assert(sameType<typeof parseRunnerError, (value: unknown) => RunResult['runnerErrors'][number]>());
        typeScope.assert(sameType<typeof createRandomRunSeed, () => bigint>());
        return typeScope.assert.collect();
    }),
    test('exposes initialization and collected execution', function (typeScope) {
        typeScope.assert(
            sameType<
                IsEqual<
                    typeof orchestrator.initialize,
                    (command: ConfiguredRunCommand | FrozenRunCommand | RunCommandInput) => Promise<InitializedRun>
                >,
                true
            >()
        );
        typeScope.assert(sameType<IsEqual<InitializedRun['collect'], () => Promise<CollectedRun>>, true>());
        typeScope.assert(sameType<CollectedRunInvocation, { readonly selection: RunSelection; }>());
        typeScope.assert(
            sameType<
                IsEqual<CollectedRun['run'], (invocation: CollectedRunInvocation) => Promise<RunnerResult>>,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsEqual<
                    CollectedRun['runWithReporterDelivery'],
                    (invocation: CollectedRunInvocation) => Promise<RunReporterDeliveryResult>
                >,
                true
            >()
        );
        typeScope.assert(
            sameType<RunCollectionError['runnerErrors'], () => readonly RunResult['runnerErrors'][number][]>()
        );
        return typeScope.assert.collect();
    }),
    test('rejects invocation policy overrides', function (typeScope) {
        typeScope.assert(
            rejectsCall('argument-type'),
            () => callUnderTest({ selection: { kind: 'all' }, runtimePolicy: null })
        );
        typeScope.assert(
            rejectsCall('argument-type'),
            () => callUnderTest({ selection: { kind: 'all' }, coverage: true })
        );
        return typeScope.assert.collect();
    })
]);
