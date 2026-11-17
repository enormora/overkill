import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import lockfile from 'proper-lockfile';
import type { HistoryPolicy } from '../config/history-policy.ts';
import {
    checkHistoryMaintenanceBudget,
    historyMaintenanceDeadline,
    recordHistoryMaintenanceDiagnostic,
    HistoryMaintenanceDeferredError
} from './history-maintenance-budget.ts';

const retryIntervalMilliseconds = 25;
export type HistoryLockOptions = Readonly<lockfile.LockOptions> & {
    readonly lockfilePath: string;
    readonly stale: number;
    readonly onCompromised: (error: Error) => void;
};

type HistoryLockStatus = { readonly mtimeMs: number; };
export type HistoryLockRelease = () => Promise<void>;
export type HistoryLockAcquirer = (
    directory: string,
    policy: HistoryPolicy,
    onCompromised: (error: Error) => void
) => Promise<HistoryLockRelease>;
export type HistoryLockRuntime = {
    readonly status: (path: string) => Promise<HistoryLockStatus>;
    readonly epoch: () => number;
    readonly monotonic: () => number;
    readonly acquire: (directory: string, options: HistoryLockOptions) => Promise<HistoryLockRelease>;
    readonly check: (directory: string, options: HistoryLockOptions) => Promise<boolean>;
    readonly wait: (milliseconds: number) => Promise<unknown>;
};
export function createHistoryLockAcquirer(runtime: HistoryLockRuntime): HistoryLockAcquirer {
    async function staleLock(options: HistoryLockOptions): Promise<boolean> {
        try {
            const status = await runtime.status(options.lockfilePath);
            return runtime.epoch() - status.mtimeMs > options.stale;
        } catch (error: unknown) {
            if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
                return false;
            }
            throw error;
        }
    }

    async function acquireProjectLock(directory: string, options: HistoryLockOptions): Promise<() => Promise<void>> {
        checkHistoryMaintenanceBudget();
        const stale = await staleLock(options);
        checkHistoryMaintenanceBudget();
        const release = await runtime.acquire(directory, options);
        if (stale) {
            recordHistoryMaintenanceDiagnostic('Stale history lock was recovered.');
        }
        return release;
    }

    async function retryLock(
        directory: string,
        options: HistoryLockOptions,
        deadline: number,
        error: unknown
    ): Promise<void> {
        checkHistoryMaintenanceBudget();
        const locked = await runtime.check(directory, options);
        if (!locked) {
            throw error;
        }
        if (runtime.monotonic() >= deadline) {
            if (Number.isFinite(historyMaintenanceDeadline())) {
                throw new HistoryMaintenanceDeferredError();
            }
            throw error;
        }
        await runtime.wait(Math.min(retryIntervalMilliseconds, Math.max(0, deadline - runtime.monotonic())));
    }

    return async function acquireHistoryLock(directory, policy, onCompromised) {
        const options = {
            lockfilePath: path.join(directory, 'history.lock'),
            stale: policy.staleLockMilliseconds,
            onCompromised
        };
        const deadline = Math.min(runtime.monotonic() + policy.lockTimeoutMilliseconds, historyMaintenanceDeadline());
        for (;;) {
            try {
                return await acquireProjectLock(directory, options);
            } catch (error: unknown) {
                await retryLock(directory, options, deadline, error);
            }
        }
    };
}
export const acquireHistoryLock = createHistoryLockAcquirer({
    status: lstat,
    epoch: Date.now,
    monotonic: performance.now.bind(performance),
    acquire: lockfile.lock,
    check: lockfile.check,
    wait: delay
});
