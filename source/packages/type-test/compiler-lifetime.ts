import { AsyncLocalStorage } from 'node:async_hooks';
import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { z } from 'zod';

const disposalSymbols: typeof Symbol & { readonly asyncDispose: typeof Symbol.asyncDispose; } = Symbol;
const asyncDispose: typeof Symbol.asyncDispose = disposalSymbols.asyncDispose;
const compilerContext = new AsyncLocalStorage<symbol>();
const processChannel = channel('child_process');
const processEvent = z.object({ process: z.instanceof(ChildProcess) });
type CompilerLifetime = AsyncDisposable & {
    readonly run: <Value>(operation: () => Value) => Value;
};

export function createCompilerLifetime(): CompilerLifetime {
    const identity = Symbol('CompilerLifetime');
    const completions: Promise<void>[] = [];
    let failure: Error | null = null;
    let disposed = false;
    function observe(message: unknown): void {
        if (compilerContext.getStore() !== identity) {
            return;
        }
        const result = processEvent.safeParse(message);
        if (!result.success) {
            failure = result.error;
            return;
        }
        completions.push(
            new Promise(function waitForExit(resolve) {
                result.data.process.once('close', function closed() {
                    resolve();
                });
            })
        );
    }
    processChannel.subscribe(observe);
    return {
        run(operation) {
            if (disposed) {
                throw new Error('Compiler lifetime is disposed.');
            }
            return compilerContext.run(identity, operation);
        },
        async [asyncDispose]() {
            disposed = true;
            try {
                await Promise.all(completions);
            } finally {
                processChannel.unsubscribe(observe);
            }
            if (failure !== null) {
                throw failure;
            }
        }
    };
}
