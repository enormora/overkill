import type { JsonValue } from 'type-fest';
import type { RunExecutionLifecycle, CollectedRunPlan } from '../run/run-types.ts';
import { currentExecutionSession, type RunExecutionTransport } from '../run/execution-session-context.ts';
import { collectedMutationPlan } from './mutation-plan-fixture.ts';
import { baselineCaseResult } from './baseline-case-fixture.ts';

export type ExecutionLifecycleFixture = {
    readonly lifecycle: RunExecutionLifecycle;
    readonly transport: RunExecutionTransport;
    readonly result: typeof baselineCaseResult.perTest[number];
    readonly controller: AbortController;
    readonly events: readonly string[];
    readonly checkpoints: readonly JsonValue[];
    readonly plan: CollectedRunPlan;
    readonly observation: { readonly signal: AbortSignal; readonly checkpoint: (data: JsonValue) => Promise<void>; };
    readonly load: (url: string) => Promise<unknown>;
};
export function executionLifecycle(disposalFailure: Error | null): ExecutionLifecycleFixture {
    const events: string[] = [];
    const checkpoints: JsonValue[] = [];
    const controller = new AbortController();
    const transport: RunExecutionTransport = {
        lifecycle: { moduleUrl: 'file:///unit-lifecycle.ts', exportName: 'create' },
        data: { value: 42 }
    };
    const result = baselineCaseResult.perTest[0];
    if (result === undefined) {
        throw new Error('Missing lifecycle result fixture.');
    }
    const lifecycle: RunExecutionLifecycle = {
        async select() {
            events.push('select');
            return { kind: 'all' };
        },
        async beforeCases() {
            events.push('before');
        },
        async enterCase() {
            events.push('enter');
        },
        async completeCase() {
            events.push('complete');
            return 'continue';
        },
        snapshot() {
            return { events: Array.from(events) };
        },
        async dispose() {
            events.push('dispose');
            if (disposalFailure !== null) {
                throw disposalFailure;
            }
        }
    };
    return {
        lifecycle,
        transport,
        result,
        controller,
        events,
        checkpoints,
        plan: collectedMutationPlan([ result.workId ]),
        observation: {
            signal: controller.signal,
            async checkpoint(data: JsonValue) {
                checkpoints.push(data);
            }
        },
        async load(url: string): Promise<unknown> {
            if (url !== transport.lifecycle.moduleUrl) {
                throw new Error('Wrong lifecycle module.');
            }
            return {
                async create(data: JsonValue) {
                    if (data === transport.data || currentExecutionSession() !== transport) {
                        throw new Error('Lifecycle transport was not isolated or installed.');
                    }
                    events.push('create');
                    return lifecycle;
                }
            };
        }
    };
}
