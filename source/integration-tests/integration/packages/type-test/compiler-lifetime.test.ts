import { type TestNode, test } from '@overkill-dev/test';
import { spawn } from 'node:child_process';

import { createCompilerLifetime } from '../../../../packages/type-test/compiler-lifetime.ts';

export const testNode: TestNode = test(
    'compiler cleanup waits for the owned process to close',
    async function (scope) {
        await using ownership = new AsyncDisposableStack();
        const lifetime = ownership.use(createCompilerLifetime());
        const child = lifetime.run(function startCompiler() {
            return spawn(process.execPath, [ '--eval', 'process.stdin.resume();' ], {
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
