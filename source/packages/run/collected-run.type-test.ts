import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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
        typeScope.assert(sameType<IsEqual<typeof parseRunSelection, (value: unknown) => RunSelection>, true>());
        typeScope.assert(
            sameType<IsEqual<typeof parseRunnerError, (value: unknown) => RunResult['runnerErrors'][number]>, true>()
        );
        typeScope.assert(sameType<IsEqual<typeof createRandomRunSeed, () => bigint>, true>());
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
        typeScope.assert(sameType<IsEqual<CollectedRunInvocation, { readonly selection: RunSelection; }>, true>());
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
            sameType<
                IsEqual<RunCollectionError['runnerErrors'], () => readonly RunResult['runnerErrors'][number][]>,
                true
            >()
        );
        return typeScope.assert.collect();
    }),
    test('rejects invocation policy overrides', function (typeScope) {
        typeScope.assert(
            rejectsCall('argument-type'),
            async () => callUnderTest({ selection: { kind: 'all' }, runtimePolicy: null })
        );
        typeScope.assert(
            rejectsCall('argument-type'),
            async () => callUnderTest({ selection: { kind: 'all' }, coverage: true })
        );
        return typeScope.assert.collect();
    })
]);
