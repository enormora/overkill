import { parseAdapterFacts } from '../config/adapter-facts.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { AdapterPreparation, CollectedAdapterRun, RunAdapterRegistration } from '../config/adapter-profile.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createRunResult } from '../engine/execution-result.ts';
import { workIdentityKey } from '../engine/identity.ts';
import { freezeValue } from './run-support.ts';
import type { ResolvedRun } from './run-types.ts';
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
    collected: CollectedAdapterRun | Promise<CollectedAdapterRun>,
    plan: TestPlan
): Promise<RunResult> {
    const startedAtMicroseconds = performance.now() * microsecondsPerMillisecond;
    try {
        const collection = await collected;
        const lowered = await collection.lower();
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
                payload: { kind: 'adapter', adapter: adapter.id, facts: parseAdapterFacts(lowered.facts) }
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
): Promise<AdapterPreparation> {
    adapter.validate(settings);
    const backend = await adapter.load();
    return await backend.prepare(plan, settings);
}

export async function collectAdapterResolvedRun(
    preparation: AdapterPreparation | null,
    run: ResolvedRun
): Promise<ResolvedRun> {
    if (preparation === null || run.plan.kind !== 'local') {
        return run;
    }
    const profile = run.config.profiles[run.request.profile];
    if (profile?.testFamily !== 'type-test') {
        throw new Error('Adapter preparation requires an adapter profile.');
    }
    const collected = await preparation.collect(run.plan.testPlan);
    const facts = parseAdapterFacts(collected.facts);
    return freezeValue({
        ...run,
        facts: { ...run.facts, adapter: { id: profile.adapter.id, facts } },
        plan: { ...run.plan, adapter: { preparation, collected } }
    });
}

type AdapterPlan = Extract<ResolvedRun['plan'], { readonly adapter: unknown; }>;
export function isAdapterPlan(plan: ResolvedRun['plan']): plan is AdapterPlan {
    return Object.hasOwn(plan, 'adapter');
}
