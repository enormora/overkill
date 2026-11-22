import { spawn } from 'node:child_process';
import { suite, test } from '@overkill-dev/test';

import {
    createCompilerLifetime,
    runCompilerOperation,
    type CompilerLifetime
} from '../../../../packages/type-test/compiler-lifetime.ts';

const waitsForClose = test(
    'compiler cleanup waits for the owned process to close',
    async function (scope) {
        await using ownership = new AsyncDisposableStack();
        const lifetime = ownership.use(createCompilerLifetime());
        const child = lifetime.run(function startCompiler() {
            return spawn(process.execPath, [ '--disable-warning=PERM0004', '--eval', 'process.stdin.resume();' ], {
                stdio: [ 'pipe', 'ignore', 'ignore' ]
            });
        });
        let closed = false;
        const completion = new Promise<void>(function waitForClose(resolve) {
            child.once('close', function close() {
                closed = true;
                resolve();
            });
        });
        scope.cleanup(async function closeCompiler() {
            if (!child.stdin.writableEnded) {
                child.stdin.end();
            }
            await completion;
        });
        child.stdin.end();
        await ownership.disposeAsync();
        scope.assert.true(closed);
        return scope.assert.collect();
    }
);

async function observeUntilClose(started: PromiseWithResolvers<undefined>): Promise<void> {
    const compiler = spawn(process.execPath, [ '--eval', 'process.stdin.resume();' ], {
        stdio: [ 'pipe', 'ignore', 'ignore' ]
    });
    const closed = Promise.withResolvers<undefined>();
    compiler.once('close', function confirmClose() {
        closed.resolve(undefined);
    });
    compiler.once('spawn', function confirmSpawn() {
        started.resolve(undefined);
    });
    await closed.promise;
}

async function cancelPendingCompiler(lifetime: CompilerLifetime): Promise<void> {
    const controller = new AbortController();
    const started = Promise.withResolvers<undefined>();
    const operation = runCompilerOperation(lifetime, controller.signal, async function waitForCompiler() {
        await observeUntilClose(started);
    });
    await started.promise;
    controller.abort(new Error('cancel compiler request'));
    await operation;
}

export const testNode = suite('compiler process lifetime', [
    waitsForClose,
    test('cancellation shuts down a pending compiler operation', async function (scope) {
        const lifetime = createCompilerLifetime();
        {
            await using owned = lifetime;
            await scope.assert.rejects(async function cancelledRequest() {
                await cancelPendingCompiler(owned);
            }, { message: 'cancel compiler request' });
        }
        scope.assert.true(lifetime.closed.aborted);
        return scope.assert.collect();
    })
]);
