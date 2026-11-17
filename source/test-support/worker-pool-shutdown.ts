import { EventEmitter } from 'node:events';
import { observeWorkerPoolLifetime } from '../run/worker-pool-creation.ts';
import type { TinypoolInstance } from '../run/tinypool-node-compatibility.ts';

type ObservedWorkerShutdown = { readonly finished: Promise<void>; readonly settled: () => boolean; };
function startShutdown(pool: TinypoolInstance): ObservedWorkerShutdown {
    let settled = false;
    const finish = async function (): Promise<void> {
        await pool.destroy();
        settled = true;
    };
    return {
        finished: finish(),
        settled() {
            return settled;
        }
    };
}
type WorkerPoolShutdownFixture = {
    readonly pool: TinypoolInstance;
    readonly workers: readonly EventEmitter[];
    readonly calls: readonly string[];
    readonly startShutdown: () => ObservedWorkerShutdown;
    readonly addWorker: () => EventEmitter;
};
export function workerPoolShutdown(runFailure: Error | null, destroyFailure: Error | null): WorkerPoolShutdownFixture {
    const workers: EventEmitter[] = [];
    const calls: string[] = [];
    const original: TinypoolInstance = {
        options: { isolateWorkers: true, maxThreads: 2 },
        get threads() {
            return workers;
        },
        async run(task, options) {
            calls.push(`run:${String(task)}:${options.name}`);
            if (runFailure !== null) {
                throw runFailure;
            }
            return task;
        },
        async destroy() {
            calls.push('destroy');
            if (destroyFailure !== null) {
                throw destroyFailure;
            }
        }
    };
    const pool = observeWorkerPoolLifetime(original);
    return {
        pool,
        startShutdown() {
            return startShutdown(pool);
        },
        workers,
        calls,
        addWorker() {
            const worker = new EventEmitter();
            workers.push(worker);
            return worker;
        }
    };
}
