import { fileURLToPath } from 'node:url';
import {
    childRole,
    benchmarkCalibrationRole,
    supervisedChildRole,
    workerPoolHostRole
} from './child-process-roles.ts';

export const childProcessEntryPointUrl = import.meta.url;

async function runChildProcessRole(role: string | null): Promise<void> {
    if (role === benchmarkCalibrationRole) {
        await import('./benchmark-calibration.entry-point.ts');
        return;
    }
    if (role === supervisedChildRole) {
        await import('./supervised-child.entry-point.ts');

        return;
    }

    if (role === workerPoolHostRole) {
        await import('./worker-pool-host.entry-point.ts');
    }
}

runChildProcessRole(
    process.argv[1] === fileURLToPath(childProcessEntryPointUrl) ? childRole(process.argv) : null
)
    .catch(function throwChildProcessRoleError(error: unknown) {
        throw error;
    });
