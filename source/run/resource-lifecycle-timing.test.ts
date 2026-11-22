import { suite, test } from '@overkill-dev/test';

import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import { resourceAttachments } from '../attachments/attachment-context.ts';

import { defineResource, type AnyResourceDefinition } from '../resources/resources.ts';
import type { RunTimingSpan } from '../engine/run-timings.ts';
import { acquireResourceWithStartupBudget } from './resource-lifecycle-startup-budget.ts';
import {
    createResourceLifecycleTiming,
    type ResourceLifecycleTiming,
    type ResourceLifecycleTimingOperation
} from './resource-lifecycle-timing.ts';

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

type LocalTimingFixture = {
    readonly spans: readonly RunTimingSpan[];
    readonly timing: ResourceLifecycleTiming;
};

function operation(signal: AbortSignal): ResourceLifecycleTimingOperation {
    return {
        phase: 'acquire' as const,
        resource: { name: 'database', scope: 'per-run' as const },
        signal
    };
}

function localTiming(clock: DeterministicClock): LocalTimingFixture {
    const spans: RunTimingSpan[] = [];
    const timing = createResourceLifecycleTiming({
        clock,
        processId: 'process-1',
        target: {
            emit(span) {
                spans.push(span);
            },
            kind: 'local'
        },
        workerId: 'worker-1'
    });

    return { spans, timing };
}

async function capturedError(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error: unknown) {
        return error;
    }

    return null;
}

function timeoutResource(): AnyResourceDefinition {
    return defineResource({
        async acquire(context) {
            return await new Promise<never>(function waitForAbort(_resolve, reject) {
                context.signal.addEventListener('abort', function rejectAfterAbort() {
                    const reason: unknown = context.signal.reason;

                    reject(reason instanceof Error ? reason : new Error(String(reason)));
                }, { once: true });
            });
        },
        dependencies: {},
        deserializeHandle(payload) {
            return payload;
        },
        dispose: null,
        name: 'database',
        requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 0 } ],
        serializeHandle: String,
        scope: 'per-run'
    });
}

export const testNode = suite({
    ...testCaseMetadata,
    title: 'Resource lifecycle timing',
    children: [ test({
        ...testCaseMetadata,
        title: 'distinguishes startup budget timeouts',
        async body(scope) {
            const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
            const fixture = localTiming(clock);
            const controller = new AbortController();

            await capturedError(async function timeoutAcquisition() {
                await fixture.timing.measure(operation(controller.signal), async function acquireResource() {
                    return await acquireResourceWithStartupBudget(timeoutResource(), {
                        workload: null,
                        attachments: resourceAttachments('test'),
                        dependencies: {},
                        scenarios: {},
                        signal: controller.signal
                    });
                });
            });

            scope.assert.equal(fixture.spans[0]?.status, 'timeout');

            return scope.assert.collect();
        }
    }) ]
});
