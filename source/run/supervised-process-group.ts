import { spawn } from 'node:child_process';
import { privateCacheDirectory } from '../private-cache-directory.ts';
import { childRoleArgument } from './child-process-roles.ts';

export const analysisOwnerRole = 'analysis-owner';
export const analysisProcessGroupArgument = '--own-analysis-group';
export const analysisOwnerPipe = 4;

async function analysisCacheDirectory(): Promise<string | null> {
    try {
        return await privateCacheDirectory('overkill-analysis-compile-cache');
    } catch {
        return null;
    }
}

export async function analysisCompileEnvironment(
    analysis: boolean,
    environment: Readonly<Record<string, string>>
): Promise<Readonly<Record<string, string>>> {
    if (
        !analysis || environment.NODE_COMPILE_CACHE !== undefined ||
        environment.NODE_DISABLE_COMPILE_CACHE === '1' || environment.NODE_V8_COVERAGE !== undefined
    ) {
        return environment;
    }
    const directory = await analysisCacheDirectory();
    return directory === null ? environment : { ...environment, NODE_COMPILE_CACHE: directory };
}

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
