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
type ProjectLockOptions = Readonly<lockfile.LockOptions> & { readonly lockfilePath: string; readonly stale: number; };

async function staleLock(options: ProjectLockOptions): Promise<boolean> {
    try {
        const status = await lstat(options.lockfilePath);
        return Date.now() - status.mtimeMs > options.stale;
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function acquireProjectLock(directory: string, options: ProjectLockOptions): Promise<() => Promise<void>> {
    checkHistoryMaintenanceBudget();
    const stale = await staleLock(options);
    checkHistoryMaintenanceBudget();
    const release = await lockfile.lock(directory, options);
    if (stale) {
        recordHistoryMaintenanceDiagnostic('Stale history lock was recovered.');
    }
    return release;
}

async function retryLock(
    directory: string,
    options: ProjectLockOptions,
    deadline: number,
    error: unknown
): Promise<void> {
    checkHistoryMaintenanceBudget();
    const locked = await lockfile.check(directory, options);
    if (!locked) {
        throw error;
    }
    if (performance.now() >= deadline) {
        if (Number.isFinite(historyMaintenanceDeadline())) {
            throw new HistoryMaintenanceDeferredError();
        }
        throw error;
    }
    await delay(Math.min(retryIntervalMilliseconds, Math.max(0, deadline - performance.now())));
}

export async function acquireHistoryLock(
    directory: string,
    policy: HistoryPolicy,
    onCompromised: (error: Error) => void
): Promise<() => Promise<void>> {
    const options = {
        lockfilePath: path.join(directory, 'history.lock'),
        stale: policy.staleLockMilliseconds,
        onCompromised
    };
    const deadline = Math.min(performance.now() + policy.lockTimeoutMilliseconds, historyMaintenanceDeadline());
    for (;;) {
        try {
            return await acquireProjectLock(directory, options);
        } catch (error: unknown) {
            await retryLock(directory, options, deadline, error);
        }
    }
}
