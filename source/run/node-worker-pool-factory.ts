import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy-snapshots.ts';
import type { DurationHistoryStore } from './duration-history.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolCreationOptions,
    WorkerPoolHostProcessStarter
} from './run-orchestrator-dependencies.ts';
import { createHostedWorkerPool } from './worker-pool-host-process.ts';
import { createPool } from './worker-pool-runtime.ts';

function missingFile(error: unknown): boolean {
    return typeof error === 'object' &&
        error !== null &&
        Reflect.get(error, 'code') === 'ENOENT';
}

function temporaryFilePath(filePath: string): string {
    return `${filePath}.${process.pid}.${Date.now()}.tmp`;
}

export function createNodeDurationHistoryStore(): DurationHistoryStore {
    return {
        async read(filePath) {
            try {
                return await readFile(filePath, 'utf8');
            } catch (error: unknown) {
                if (missingFile(error)) {
                    return null;
                }

                throw error;
            }
        },
        async write(filePath, content) {
            await mkdir(path.dirname(filePath), { recursive: true });
            const temporaryPath = temporaryFilePath(filePath);

            await writeFile(temporaryPath, content);
            await rename(temporaryPath, filePath);
        }
    };
}

export function createWorkerPoolWithHostProcess(
    options: WorkerPoolCreationOptions,
    environmentVariables: RuntimeCapabilityPolicyEnvironment,
    startWorkerPoolHost: WorkerPoolHostProcessStarter
): CreatedWorkerPool {
    if (options.hostProcess.kind === 'direct') {
        return createPool(options);
    }

    return createHostedWorkerPool({
        environmentVariables,
        options,
        startWorkerPoolHost
    });
}
