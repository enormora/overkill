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
    test('exposes typed transport parsers and seed generation', function (scope) {
        scope.assert(sameType<IsEqual<typeof parseRunResult, (value: unknown) => RunResult>, true>());
        scope.assert(sameType<IsEqual<typeof parseRunnerResult, (value: unknown) => RunnerResult>, true>());
        scope.assert(sameType<
            IsEqual<
                RunnerResult,
                RunResult & {
                    readonly context: RunReport['context'];
                    readonly maintenanceDiagnostics: readonly string[];
                }
            >,
            true
        >());
        scope.assert(sameType<IsEqual<typeof parseRunSelection, (value: unknown) => RunSelection>, true>());
        scope.assert(
            sameType<IsEqual<typeof parseRunnerError, (value: unknown) => RunResult['runnerErrors'][number]>, true>()
        );
        scope.assert(sameType<IsEqual<typeof createRandomRunSeed, () => bigint>, true>());
        return scope.assert.collect();
    }),
    test('exposes initialization and collected execution', function (scope) {
        scope.assert(
            sameType<
                IsEqual<
                    typeof orchestrator.initialize,
                    (command: ConfiguredRunCommand | FrozenRunCommand | RunCommandInput) => Promise<InitializedRun>
                >,
                true
            >()
        );
        scope.assert(sameType<IsEqual<InitializedRun['collect'], () => Promise<CollectedRun>>, true>());
        scope.assert(sameType<IsEqual<CollectedRunInvocation, { readonly selection: RunSelection; }>, true>());
        scope.assert(
            sameType<
                IsEqual<CollectedRun['run'], (invocation: CollectedRunInvocation) => Promise<RunnerResult>>,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<
                    CollectedRun['runWithReporterDelivery'],
                    (invocation: CollectedRunInvocation) => Promise<RunReporterDeliveryResult>
                >,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<RunCollectionError['runnerErrors'], () => readonly RunResult['runnerErrors'][number][]>,
                true
            >()
        );
        return scope.assert.collect();
    }),
    test('rejects invocation policy overrides', function (scope) {
        scope.assert(
            rejectsCall('argument-type'),
            async function () {
                return callUnderTest({ selection: { kind: 'all' }, runtimePolicy: null });
            }
        );
        scope.assert(
            rejectsCall('argument-type'),
            async function () {
                return callUnderTest({ selection: { kind: 'all' }, coverage: true });
            }
        );
        return scope.assert.collect();
    })
]);
