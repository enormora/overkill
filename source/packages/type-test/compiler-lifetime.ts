import { AsyncLocalStorage } from 'node:async_hooks';
import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import * as timers from 'node:timers';
import { z } from 'zod';

const disposalSymbols: typeof Symbol & { readonly asyncDispose: typeof Symbol.asyncDispose; } = Symbol;
const asyncDispose: typeof Symbol.asyncDispose = disposalSymbols.asyncDispose;
const compilerContext = new AsyncLocalStorage<symbol>();
const processChannel = channel('child_process');
const processEvent = z.object({ process: z.instanceof(ChildProcess) });
const compilerShutdownMilliseconds = 1000;
export type CompilerLifetime = AsyncDisposable & {
    readonly closed: AbortSignal;
    readonly terminate: () => void;
    readonly run: <Value>(operation: () => Value) => Value;
};

export function createCompilerLifetime(): CompilerLifetime {
    const identity = Symbol('CompilerLifetime');
    const children = new Map<ChildProcess, Promise<void>>();
    const closed = new AbortController();
    let terminated = false;
    let failure: Error | null = null;

    function retainChild(child: ChildProcess): void {
        children.set(
            child,
            new Promise(function waitForClose(resolve) {
                child.once('close', function childClosed() {
                    children.delete(child);
                    closed.abort(new Error('Native TypeScript compiler closed.'));
                    resolve();
                });
            })
        );
        function terminateCancelledSpawn(): void {
            if (terminated) {
                child.kill('SIGKILL');
            }
        }
        child.once('spawn', terminateCancelledSpawn);
        terminateCancelledSpawn();
    }

    function observe(message: unknown): void {
        if (compilerContext.getStore() !== identity) {
            return;
        }
        const result = processEvent.safeParse(message);
        if (!result.success) {
            failure = result.error;
            return;
        }
        retainChild(result.data.process);
    }
    function terminate(): void {
        terminated = true;
        for (const child of children.keys()) {
            child.kill('SIGKILL');
        }
    }
    processChannel.subscribe(observe);
    return {
        closed: closed.signal,
        terminate,
        run(operation) {
            closed.signal.throwIfAborted();
            return compilerContext.run(identity, operation);
        },
        async [asyncDispose]() {
            closed.abort(new Error('Compiler lifetime is disposed.'));
            try {
                const timer = timers.setTimeout(terminate, compilerShutdownMilliseconds);
                try {
                    await Promise.all(children.values());
                } finally {
                    timers.clearTimeout(timer);
                }
            } finally {
                processChannel.unsubscribe(observe);
            }
            if (failure !== null) {
                throw failure;
            }
        }
    };
}

type CompilerCancellation = {
    readonly interrupted: Promise<never>;
    readonly dispose: () => void;
};

function observeCompilerCancellation(stopped: AbortSignal): CompilerCancellation {
    const interrupted = Promise.withResolvers<never>();
    const listeners = new AbortController();
    stopped.addEventListener('abort', function interrupt() {
        interrupted.reject(stopped.reason);
    }, { once: true, signal: listeners.signal });
    return {
        interrupted: interrupted.promise,
        dispose() {
            listeners.abort();
            interrupted.reject(stopped.reason);
        }
    };
}

export async function runCompilerOperation<Value>(
    lifetime: CompilerLifetime,
    signal: AbortSignal,
    operation: () => Promise<Value>
): Promise<Value> {
    const stopped = AbortSignal.any([ signal, lifetime.closed ]);
    stopped.throwIfAborted();
    const cancellation = observeCompilerCancellation(stopped);
    try {
        const value = await Promise.race([ lifetime.run(operation), cancellation.interrupted ]);
        signal.throwIfAborted();
        return value;
    } catch (error: unknown) {
        signal.throwIfAborted();
        throw error;
    } finally {
        cancellation.dispose();
    }
}

export async function closeCompilerConnection(lifetime: CompilerLifetime, release: () => Promise<void>): Promise<void> {
    const expired = Promise.withResolvers<never>();
    const timer = timers.setTimeout(function endCompilerShutdown() {
        lifetime.terminate();
        expired.reject(new Error('Native TypeScript compiler shutdown exceeded its deadline.'));
    }, compilerShutdownMilliseconds);
    try {
        await Promise.race([ release(), expired.promise ]);
    } finally {
        timers.clearTimeout(timer);
        expired.reject(lifetime.closed.reason);
    }
}
