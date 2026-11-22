import { spawn } from 'node:child_process';
import { childRoleArgument } from './child-process-roles.ts';

export const analysisOwnerRole = 'analysis-owner';
export const analysisProcessGroupArgument = '--own-analysis-group';
export const analysisOwnerPipe = 4;

export async function startAnalysisOwnerMonitor(entryPoint: string): Promise<void> {
    const owner = spawn(process.execPath, [
        entryPoint,
        childRoleArgument(analysisOwnerRole),
        String(process.pid)
    ], { stdio: [ analysisOwnerPipe, 'ignore', 'ignore' ] });
    await new Promise<void>(function monitorStarted(resolve, reject) {
        owner.once('spawn', resolve);
        owner.once('error', reject);
    });
    owner.unref();
}

export function signalAnalysisGroup(group: number): boolean {
    try {
        return process.kill(-group, 'SIGKILL');
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ESRCH') {
            return false;
        }
        throw error;
    }
}

export function monitorAnalysisOwner(groupArgument: string | undefined): void {
    const group = Number(groupArgument);
    if (!Number.isSafeInteger(group) || group <= 1) {
        throw new TypeError('Invalid analysis process group.');
    }
    process.stdin.once('end', function terminateUnownedAnalysis() {
        signalAnalysisGroup(group);
    });
    process.stdin.resume();
}
