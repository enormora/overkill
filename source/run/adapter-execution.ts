import type { TestPlan } from '../engine/test-plan.ts';
import type { RunAdapterRegistration } from '../config/adapter-profile.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createRunResult } from '../engine/execution-result.ts';
import { workIdentityKey } from '../engine/identity.ts';
import { parseRunResult } from './run-result-schema.ts';

const microsecondsPerMillisecond = 1000;

function validatedAdapterResult(plan: TestPlan, value: unknown): RunResult {
    const result = parseRunResult(value);
    const planned = new Set(plan.cases.map(function identity(entry) {
        return workIdentityKey(entry.workId);
    }));
    const observed = result.perTest.map(function identity(entry) {
        return workIdentityKey(entry.workId);
    });
    const distinct = new Set(observed);
    if (
        distinct.size !== observed.length || observed.some(function unknownWork(key) {
            return !planned.has(key);
        })
    ) {
        throw new Error('Adapter returned duplicate or unknown work identities.');
    }
    if (observed.length !== planned.size && result.runnerErrors.length === 0) {
        throw new Error('Adapter returned incomplete work evidence without a runner error.');
    }
    return result;
}

export async function executeAdapterPlan(
    adapter: RunAdapterRegistration,
    settings: unknown,
    plan: TestPlan
): Promise<RunResult> {
    adapter.validate(settings);
    const startedAtMicroseconds = performance.now() * microsecondsPerMillisecond;
    try {
        const backend = await adapter.load();
        const collected = await backend.collect(plan, settings);
        const lowered = await collected.lower();
        const result = validatedAdapterResult(plan, await lowered.execute());
        return {
            ...result,
            artifacts: [ ...result.artifacts, {
                id: {
                    subtype: 'adapter',
                    sequence: result.artifacts.length,
                    scope: { kind: 'run' },
                    attempt: null,
                    runtimes: [],
                    workload: null
                },
                source: 'native',
                payload: { kind: 'adapter', adapter: adapter.id, facts: lowered.facts }
            } ]
        };
    } catch (error: unknown) {
        return createRunResult(plan, [], [ {
            subtype: 'loader',
            cause: error,
            message: `Adapter checking failed: ${String(error)}`,
            attributedTo: null,
            attributedToAttempt: null,
            diagnostics: []
        } ], {
            startedAtMicroseconds,
            completedAtMicroseconds: performance.now() * microsecondsPerMillisecond,
            testExecutionWallTimeMicroseconds: 0,
            processUsage: null,
            planStatus: 'planned'
        });
    }
}

export async function prepareAdapterPlan(
    adapter: RunAdapterRegistration,
    settings: unknown,
    plan: TestPlan
): Promise<TestPlan> {
    adapter.validate(settings);
    const backend = await adapter.load();
    return await backend.prepare(plan, settings);
}
