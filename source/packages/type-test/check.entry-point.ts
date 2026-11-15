import { createRunResult, type Engine, type TestRoot } from '../engine/engine.entry-point.ts';
import type { RunnerResult, RunRequest } from '../run/run.entry-point.ts';
import type { TypeTestOptions } from './profile-settings.ts';
import { family } from './profile.entry-point.ts';

const microsecondsPerMillisecond = 1000;

export type TypeTestCheckRequest = TypeTestOptions & {
    readonly engine: Engine;
    readonly root: TestRoot;
    readonly selection: RunRequest['selection'];
    readonly order: RunRequest['order'];
    readonly seed: RunRequest['seed'];
    readonly shard: RunRequest['shard'];
};

async function checkPreparedTypeTests(request: TypeTestCheckRequest): Promise<RunnerResult> {
    const { planTestSelection } = await import('../run/run.entry-point.ts');
    const { signal } = new AbortController();
    await using prepared = await request.engine.prepareFamily({
        testPlan: request.engine.createTestPlan(request.root, {
            runtimeMatrices: true,
            benchmarkCalibration: false,
            property: null
        }),
        testFamily: family,
        settings: { projectConfigPath: request.projectConfigPath, compiler: request.compiler },
        projectRoot: process.cwd(),
        signal
    });
    const selection = await planTestSelection(prepared.testPlan, request);
    if (selection.kind === 'empty-shard') {
        return { ...selection.result, maintenanceDiagnostics: [] };
    }
    const collected = await prepared.collect({
        workIds: selection.testPlan.cases.map(function identity(testCase) {
            return testCase.workId;
        }),
        signal
    });
    const startedAt = new Date();
    return {
        ...await request.engine.execute(collected, {
            signal,
            debug: { mode: 'off' },
            retryPolicy: null,
            reporters: [],
            execution: { mode: 'serial-in-process' },
            runFacts: {},
            startedAt: startedAt.toISOString()
        }),
        maintenanceDiagnostics: []
    };
}

export async function checkTypeTests(request: TypeTestCheckRequest): Promise<RunnerResult> {
    const { parseRunSelection } = await import('../run/run.entry-point.ts');
    parseRunSelection(request.selection);
    const startedAtMicroseconds = performance.now() * microsecondsPerMillisecond;
    try {
        return await checkPreparedTypeTests(request);
    } catch (error: unknown) {
        return {
            ...createRunResult(request.engine.createTestPlan(request.root), [], [ {
                subtype: 'loader',
                cause: error,
                message: String(error),
                attributedTo: null,
                attributedToAttempt: null,
                diagnostics: []
            } ], {
                startedAtMicroseconds,
                completedAtMicroseconds: performance.now() * microsecondsPerMillisecond,
                testExecutionWallTimeMicroseconds: 0,
                processUsage: null,
                planStatus: 'planned'
            }),
            maintenanceDiagnostics: []
        };
    }
}
