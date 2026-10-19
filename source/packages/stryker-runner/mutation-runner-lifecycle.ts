import { createClock } from '@enormora/clock';
import {
    ConfigError,
    createInvocationBudget,
    InvocationDeadlineExceededError,
    isInvocationCancellation,
    type InvocationBudget
} from '../run/run.entry-point.ts';
import {
    initializeMutationRunner,
    type ReadyMutationRunner,
    type RunnerInitialization
} from './mutation-runner-initialization.ts';
import type { CampaignClient } from './campaign-client.ts';

export type MutationRunnerLifecycle = {
    readonly ready: (budget: InvocationBudget | null) => Promise<ReadyMutationRunner>;
    readonly invoke: <Value extends { readonly status: string; }>(
        timeout: number,
        run: (runner: ReadyMutationRunner, budget: InvocationBudget) => Promise<Value>,
        expired: (completed: Value | null) => Value
    ) => Promise<Value>;
    readonly dispose: () => Promise<void>;
};

async function disposeRunner(initialization: Promise<ReadyMutationRunner> | null): Promise<void> {
    const settled = await Promise.allSettled(initialization === null ? [] : [ initialization ]);
    const initialized = settled[0];
    if (initialized?.status === 'fulfilled') {
        try {
            await initialized.value.execution.dispose();
        } finally {
            initialized.value.client.dispose();
        }
    }
}

type BudgetInvocation<Value> = {
    readonly ready: MutationRunnerLifecycle['ready'];
    readonly run: (runner: ReadyMutationRunner, budget: InvocationBudget) => Promise<Value>;
    readonly expired: (completed: Value | null) => Value;
    readonly budget: InvocationBudget;
};
function observeInitializationDeadline(
    budget: InvocationBudget | null,
    clients: ReadonlyMap<'connected', CampaignClient>
): () => Promise<void> {
    const observation = new AbortController();
    const deliveries = new Set<Promise<void>>();
    function cancelInitialization(): void {
        if (budget?.expired() !== true) {
            return;
        }
        const client = clients.get('connected');
        if (client !== undefined) {
            deliveries.add(client.expireRequests());
        }
    }
    budget?.signal.addEventListener('abort', cancelInitialization, { once: true, signal: observation.signal });
    if (budget?.signal.aborted === true) {
        cancelInitialization();
    }
    return async function stopInitializationDeadline() {
        observation.abort();
        await Promise.all(deliveries);
    };
}
async function completeInvocation<Value extends { readonly status: string; }>(
    input: BudgetInvocation<Value>
): Promise<Value> {
    const runner = await input.ready(input.budget);
    if (input.budget.expired()) {
        return input.expired(null);
    }
    const result = await input.run(runner, input.budget);
    return result.status !== 'error' && input.budget.expired() ? input.expired(result) : result;
}
async function runBudgetInvocation<Value extends { readonly status: string; }>(
    input: BudgetInvocation<Value>
): Promise<Value> {
    try {
        return await completeInvocation(input);
    } catch (error: unknown) {
        if (
            input.budget.expired() &&
            (error instanceof InvocationDeadlineExceededError || isInvocationCancellation(error, input.budget.signal))
        ) {
            return input.expired(null);
        }
        throw error;
    }
}

export function createMutationRunnerLifecycle(
    options: RunnerInitialization['options'],
    files: Readonly<RunnerInitialization['files']>,
    logger: RunnerInitialization['logger']
): MutationRunnerLifecycle {
    const controller = new AbortController();
    const clock = createClock();
    let initialization: Promise<ReadyMutationRunner> | null = null;
    let initializationBudget: InvocationBudget | null = null;
    const ownership = {
        active: new Set<InvocationBudget>(),
        disposed: new Set<'runner'>(),
        clients: new Map<'connected', CampaignClient>(),
        closing: new Map<'shutdown', Promise<void>>()
    };
    async function ready(budget: InvocationBudget | null): Promise<ReadyMutationRunner> {
        if (ownership.disposed.has('runner')) {
            throw new ConfigError('Stryker runner has been disposed.');
        }
        initializationBudget = budget;
        const initializing = initialization ??
            initializeMutationRunner({
                options,
                files,
                logger,
                signal: controller.signal,
                budget() {
                    return initializationBudget;
                },
                connected(client) {
                    ownership.clients.set('connected', client);
                }
            });
        initialization = initializing;
        const stop = observeInitializationDeadline(budget, ownership.clients);
        try {
            return await initializing;
        } finally {
            await stop();
        }
    }
    async function closeRunner(): Promise<void> {
        ownership.disposed.add('runner');
        const client = ownership.clients.get('connected');
        if (client === undefined) {
            controller.abort();
        }
        if (client !== undefined) {
            await Promise.allSettled([ client.request({ kind: 'release' }, null) ]);
        }
        controller.abort();
        await disposeRunner(initialization);
    }
    return {
        ready,
        async invoke(timeout, run, expired) {
            if (ownership.active.size > 0) {
                throw new Error('A Stryker invocation is already running.');
            }
            if (!Number.isFinite(timeout) || timeout <= 0) {
                return expired(null);
            }
            const budget = createInvocationBudget(timeout, controller.signal, clock);
            ownership.active.add(budget);
            try {
                return await runBudgetInvocation({ ready, run, expired, budget });
            } finally {
                budget.dispose();
                ownership.active.delete(budget);
            }
        },
        async dispose() {
            const closing = ownership.closing.get('shutdown') ?? closeRunner();
            ownership.closing.set('shutdown', closing);
            await closing;
        }
    };
}
