import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '#test-runner';

const pollMilliseconds = 25;
const maximumPolls = 200;
type ProcessOwner = { readonly stop: () => void; };

function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function parseTargetIdentity(storedIdentity: string): number | null {
    const identity = Number(storedIdentity);
    return Number.isSafeInteger(identity) && identity > 1 ? identity : null;
}

async function readTargetIdentity(file: string): Promise<number | null> {
    try {
        return parseTargetIdentity(await readFile(file, 'utf8'));
    } catch {
        return null;
    }
}

async function targetIdentity(file: string): Promise<number> {
    for (let attempt = 0; attempt < maximumPolls; attempt += 1) {
        const identity = await readTargetIdentity(file);
        if (identity !== null) {
            return identity;
        }
        await wait(pollMilliseconds);
    }
    throw new Error('Worker target did not start.');
}

async function awaitTargetExit(pid: number): Promise<void> {
    for (let attempt = 0; attempt < maximumPolls && processExists(pid); attempt += 1) {
        await wait(pollMilliseconds);
    }
}

function startProcessOwner(file: string): ProcessOwner {
    const owner = fork(new URL('./fixtures/process-owner.test.ts', import.meta.url), [ file ], {
        detached: true,
        execArgv: [],
        stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ]
    });
    const identity = owner.pid;
    if (identity === undefined) {
        throw new Error('Process owner did not start.');
    }
    return {
        stop() {
            if (processExists(identity)) {
                process.kill(-identity, 'SIGKILL');
            }
        }
    };
}

export const testNode = suite('process helper ownership', [
    test('reaps the target when the owner process group is killed', async function (scope: TestScope) {
        const directory = await mkdtemp(join(tmpdir(), 'overkill-group-owner-'));
        scope.cleanup(async function () {
            await rm(directory, { recursive: true, force: true });
        });
        const owner = startProcessOwner(join(directory, 'target'));
        scope.cleanup(owner.stop);
        const pid = await targetIdentity(join(directory, 'target'));
        scope.cleanup(function () {
            if (processExists(pid)) {
                process.kill(-pid, 'SIGKILL');
            }
        });
        owner.stop();
        await awaitTargetExit(pid);
        scope.assert.false(processExists(pid));
        return scope.assert.collect();
    }),
    test('reaps the target when its worker is forcibly terminated', async function (scope) {
        const directory = await mkdtemp(join(tmpdir(), 'overkill-owner-'));
        const worker = new Worker(new URL('./fixtures/process-owner.test.ts', import.meta.url), {
            workerData: join(directory, 'target')
        });
        scope.cleanup(async function () {
            await worker.terminate();
            await rm(directory, { recursive: true, force: true });
        });
        const pid = await targetIdentity(join(directory, 'target'));
        scope.cleanup(function () {
            if (processExists(pid)) {
                process.kill(-pid, 'SIGKILL');
            }
        });
        scope.assert.true(processExists(pid));
        await worker.terminate();
        await awaitTargetExit(pid);
        scope.assert.false(processExists(pid));
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
