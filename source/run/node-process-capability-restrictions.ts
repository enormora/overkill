type ProcessHost = {
    readonly abort: typeof process.abort;
    readonly addListener: typeof process.addListener;
    readonly exit: typeof process.exit;
    readonly kill: typeof process.kill;
    readonly on: typeof process.on;
    readonly once: typeof process.once;
    readonly prependListener: typeof process.prependListener;
    readonly prependOnceListener: typeof process.prependOnceListener;
    readonly send?: typeof process.send;
};

type ProcessExecutionMethods = {
    readonly abort: ProcessHost['abort'];
    readonly execute: unknown;
    readonly exit: ProcessHost['exit'];
    readonly kill: ProcessHost['kill'];
};

type ProcessIpcMethods = {
    readonly addListener: ProcessHost['addListener'];
    readonly on: ProcessHost['on'];
    readonly once: ProcessHost['once'];
    readonly prependListener: ProcessHost['prependListener'];
    readonly prependOnceListener: ProcessHost['prependOnceListener'];
    readonly send: ProcessHost['send'];
};

const processExecuteFunctionName = [ 'exec', 've' ].join('');

function readProcessExecutionMethods(processObject: ProcessHost): ProcessExecutionMethods {
    return {
        abort: processObject.abort,
        execute: Reflect.get(processObject, processExecuteFunctionName),
        exit: processObject.exit,
        kill: processObject.kill
    };
}

function restoreProcessExecutionMethods(processObject: ProcessHost, originals: ProcessExecutionMethods): void {
    Reflect.set(processObject, 'abort', originals.abort);
    Reflect.set(processObject, processExecuteFunctionName, originals.execute);
    Reflect.set(processObject, 'exit', originals.exit);
    Reflect.set(processObject, 'kill', originals.kill);
}

function replaceProcessExecutionMethods(
    processObject: ProcessHost,
    originals: ProcessExecutionMethods,
    record: (message: string) => void
): void {
    const blocked = new Error('Runtime policy violation: process execution is restricted.');

    Reflect.set(processObject, 'abort', function restrictedProcessAbort(): never {
        record('Runtime policy violation: process.abort() was called.');
        throw blocked;
    });
    Reflect.set(processObject, 'exit', function restrictedProcessExit(code?: number | string | null): never {
        record(`Runtime policy violation: process.exit(${String(code ?? '')}) was called.`);
        throw blocked;
    });
    Reflect.set(processObject, 'kill', function restrictedProcessKill(pid: number, signal?: number | string): boolean {
        record(`Runtime policy violation: process.kill(${String(pid)}, ${String(signal ?? '')}) was called.`);

        return false;
    });

    if (typeof originals.execute === 'function') {
        Reflect.set(processObject, processExecuteFunctionName, function restrictedProcessExecute(): never {
            record(`Runtime policy violation: process.${processExecuteFunctionName}() was called.`);
            throw blocked;
        });
    }
}

export function installProcessExecutionRestriction(
    processObject: ProcessHost,
    record: (message: string) => void
): () => void {
    const originals = readProcessExecutionMethods(processObject);

    replaceProcessExecutionMethods(processObject, originals, record);

    return function restoreProcessExecutionRestriction(): void {
        restoreProcessExecutionMethods(processObject, originals);
    };
}

function readProcessIpcMethods(processObject: ProcessHost): ProcessIpcMethods {
    return {
        addListener: processObject.addListener,
        on: processObject.on,
        once: processObject.once,
        prependListener: processObject.prependListener,
        prependOnceListener: processObject.prependOnceListener,
        send: processObject.send
    };
}

function restoreProcessIpcMethods(processObject: ProcessHost, originals: ProcessIpcMethods): void {
    Reflect.set(processObject, 'addListener', originals.addListener);
    Reflect.set(processObject, 'on', originals.on);
    Reflect.set(processObject, 'once', originals.once);
    Reflect.set(processObject, 'prependListener', originals.prependListener);
    Reflect.set(processObject, 'prependOnceListener', originals.prependOnceListener);
    Reflect.set(processObject, 'send', originals.send);
}

function restrictedMessageListener(
    processObject: ProcessHost,
    original: unknown,
    record: (message: string) => void
): (eventName: string | symbol, ...listenerArguments: readonly unknown[]) => ProcessHost {
    return function restrictedListener(eventName, ...listenerArguments) {
        if (eventName === 'message') {
            record('Runtime policy violation: process message listener registration was blocked.');

            return processObject;
        }

        if (typeof original === 'function') {
            Reflect.apply(original, processObject, [ eventName, ...listenerArguments ]);
        }

        return processObject;
    };
}

function replaceProcessIpcMethods(
    processObject: ProcessHost,
    originals: ProcessIpcMethods,
    record: (message: string) => void
): void {
    Reflect.set(processObject, 'addListener', restrictedMessageListener(processObject, originals.addListener, record));
    Reflect.set(processObject, 'on', restrictedMessageListener(processObject, originals.on, record));
    Reflect.set(processObject, 'once', restrictedMessageListener(processObject, originals.once, record));
    Reflect.set(
        processObject,
        'prependListener',
        restrictedMessageListener(processObject, originals.prependListener, record)
    );
    Reflect.set(
        processObject,
        'prependOnceListener',
        restrictedMessageListener(processObject, originals.prependOnceListener, record)
    );
    Reflect.set(processObject, 'send', function restrictedProcessSend(): boolean {
        record('Runtime policy violation: process.send() was blocked.');

        return false;
    });
}

export function installIpcRestriction(
    processObject: ProcessHost,
    record: (message: string) => void
): () => void {
    const originals = readProcessIpcMethods(processObject);

    replaceProcessIpcMethods(processObject, originals, record);

    return function restoreIpcRestriction(): void {
        restoreProcessIpcMethods(processObject, originals);
    };
}
