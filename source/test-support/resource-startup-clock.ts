import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { defineResource, type ExecutionRequirement } from '../resources/resources.ts';
import { resourceAttachments } from '../attachments/attachment-context.ts';
import { acquireBudgetedResource, type StartupBudgetRuntime } from '../run/resource-lifecycle-startup-budget.ts';

type StartupClockFixture = {
    readonly runtime: StartupBudgetRuntime;
    readonly scheduled: readonly number[];
    readonly expire: () => void;
    readonly cancellations: () => number;
    readonly pending: () => number;
};
export function startupClock(): StartupClockFixture {
    const scheduled: number[] = [];
    const active = new Set<() => void>();
    let cancellations = 0;
    const runtime: StartupBudgetRuntime = {
        schedule(milliseconds, expire) {
            scheduled.push(milliseconds);
            active.add(expire);
            return function () {
                cancellations += 1;
                active.delete(expire);
            };
        }
    };
    return {
        runtime,
        scheduled,
        expire() {
            for (const expire of active) {
                expire();
            }
        },
        cancellations() {
            return cancellations;
        },
        pending() {
            return active.size;
        }
    };
}
type StartupResourceFixture = {
    readonly parent: AbortController;
    readonly observed: StoredValue<AbortSignal | null>;
    readonly failure: Error;
    readonly acquire: (runtime: StartupBudgetRuntime) => Promise<unknown>;
};
export function startupResource(
    requirements: readonly ExecutionRequirement[],
    mode: 'error' | 'success' | 'wait'
): StartupResourceFixture {
    const parent = new AbortController();
    const observed = createStoredValue<AbortSignal | null>(null);
    const failure = new Error('resource failed');
    const resource = defineResource({
        name: 'database',
        scope: 'per-case',
        requirements,
        dispose: null,
        async acquire(context) {
            observed.write(context.signal);
            if (mode === 'error') {
                throw failure;
            }
            if (mode === 'success') {
                return 'handle';
            }
            return new Promise<string>(function (_resolve, reject) {
                context.signal.addEventListener('abort', function () {
                    const reason: unknown = context.signal.reason;
                    reject(reason instanceof Error ? reason : new Error(String(reason)));
                }, { once: true });
            });
        }
    });
    return {
        parent,
        observed,
        failure,
        async acquire(runtime: StartupBudgetRuntime) {
            return await acquireBudgetedResource(resource, {
                signal: parent.signal,
                attachments: resourceAttachments('unit'),
                dependencies: {},
                scenarios: {},
                workload: null
            }, runtime);
        }
    };
}
