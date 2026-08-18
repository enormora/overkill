import { describe, expect, test } from 'tstyche';
import type { OutputRenderer, Reporter, RunResult, TestPlan } from '../engine/engine.entry-point.ts';
import {
    RunResolutionError,
    type orchestrator,
    type ResolvedRun,
    type RunCommand,
    type RunConfig,
    type RunFacts,
    type RunOrchestrator,
    type RunRequest,
    type SerializedValue
} from './run.entry-point.ts';

type RunRequestKeys = readonly [
    'baselineUpdateMode',
    'capture',
    'coverage',
    'debug',
    'execution',
    'order',
    'paths',
    'profile',
    'seed',
    'selection',
    'shard',
    'verbose'
];

type ExpectedRunRequestKey = RunRequestKeys[number];

describe('@overkill-dev/run', function () {
    test('exposes the typed run command surface', function () {
        expect<keyof RunCommand>().type.toBe<'config' | 'request' | 'testPlan'>();
        expect<RunCommand['config']>().type.toBe<RunConfig>();
        expect<RunCommand['request']>().type.toBe<RunRequest>();
        expect<RunCommand['testPlan']>().type.toBe<TestPlan>();
        expect<typeof orchestrator>().type.toBe<RunOrchestrator>();
        expect<typeof orchestrator.resolve>().type.toBe<(command: RunCommand) => Promise<ResolvedRun>>();
        expect<typeof orchestrator.run>().type.toBe<(command: RunCommand) => Promise<RunResult>>();
    });

    test('keeps request fields explicit for the implemented runner slice', function () {
        expect<keyof RunRequest>().type.toBe<ExpectedRunRequestKey>();
        expect<RunRequest['execution']['mode']>().type.toBe<'concurrent-in-process'>();
        expect<RunRequest['order']>().type.toBe<'plan'>();
    });

    test('exposes serializable run facts with case metadata', function () {
        expect<keyof RunFacts>().type.toBe<'cases' | 'environment' | 'execution' | 'loader' | 'reproducibility'>();
        expect<RunFacts['cases'][number]['metadata']>().type.toBe<SerializedValue>();
        expect<RunFacts>().type.toBeAssignableTo<Readonly<Record<string, unknown>>>();
    });

    test('exposes config and resolution errors', function () {
        expect<keyof RunConfig>().type.toBe<'loader' | 'outputRenderer' | 'reporters' | 'runtimeStateDir'>();
        expect<RunConfig['outputRenderer']>().type.toBe<OutputRenderer>();
        expect<RunConfig['reporters']>().type.toBe<readonly Reporter[]>();
        expect(new RunResolutionError('Unsupported.', undefined, 'unsupported-request')).type.toBe<
            RunResolutionError
        >();
    });
});
