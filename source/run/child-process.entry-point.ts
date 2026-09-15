import {
    childRole,
    supervisedChildRole,
    workerPoolHostRole
} from './child-process-roles.ts';

export const childProcessEntryPointUrl = import.meta.url;

async function runChildProcessRole(role: string | null): Promise<void> {
    if (role === supervisedChildRole) {
        await import('./supervised-child.entry-point.ts');

        return;
    }

    if (role === workerPoolHostRole) {
        await import('./worker-pool-host.entry-point.ts');
    }
}

runChildProcessRole(childRole(process.argv)).catch(function throwChildProcessRoleError(error: unknown) {
    throw error;
});
