import { fileURLToPath } from 'node:url';
import {
    childRole,
    benchmarkCalibrationRole,
    supervisedChildRole,
    workerPoolHostRole
} from './child-process-roles.ts';

import {
    analysisOwnerRole,
    analysisProcessGroupArgument,
    monitorAnalysisOwner,
    startAnalysisOwnerMonitor
} from './supervised-process-group.ts';

export const childProcessEntryPointUrl = import.meta.url;

async function runSupervisedRole(): Promise<void> {
    if (process.argv.includes(analysisProcessGroupArgument)) {
        await startAnalysisOwnerMonitor(fileURLToPath(childProcessEntryPointUrl));
        const { enableAnalysisCompileCache } = await import('./analysis-compile-cache.ts');
        await enableAnalysisCompileCache();
    }
    await import('./supervised-child.entry-point.ts');
}

const childRoles = new Map<string, () => Promise<void> | void>([
    [ 'corpus-codec', async function runCorpusCodec() {
        await import('./corpus-codec.entry-point.ts');
    } ],
    [ benchmarkCalibrationRole, async function calibrateBenchmark() {
        await import('./benchmark-calibration.entry-point.ts');
    } ],
    [ supervisedChildRole, runSupervisedRole ],
    [ analysisOwnerRole, function monitorOwner() {
        monitorAnalysisOwner(process.argv.at(-1));
    } ],
    [ workerPoolHostRole, async function runWorkerPool() {
        await import('./worker-pool-host.entry-point.ts');
    } ]
]);

async function runChildProcessRole(role: string | null): Promise<void> {
    if (role !== null) {
        await childRoles.get(role)?.();
    }
}

runChildProcessRole(
    process.argv[1] === fileURLToPath(childProcessEntryPointUrl) ? childRole(process.argv) : null
)
    .catch(function throwChildProcessRoleError(error: unknown) {
        throw error;
    });
