import { createRequire } from 'node:module';
import type { Worker as NodeWorker } from 'node:worker_threads';

type TinypoolFilledOptions = {
    readonly isolateWorkers: boolean;
    readonly maxThreads: number;
};

type TinypoolRunOptions = {
    readonly name: string;
    readonly signal: AbortSignal;
    readonly transferList: readonly unknown[];
};

type TinypoolOptions = {
    readonly concurrentTasksPerWorker: number;
    readonly filename: string;
    readonly isolateWorkers: boolean;
    readonly maxThreads: number;
    readonly minThreads: number;
    readonly runtime: 'worker_threads';
};

export type TinypoolInstance = {
    readonly destroy: () => Promise<void>;
    readonly options: TinypoolFilledOptions;
    run: (task: unknown, options: TinypoolRunOptions) => Promise<unknown>;
};

export type TinypoolConstructor = new (options: TinypoolOptions) => TinypoolInstance;

export type TinypoolNodeCompatibility = NodeWorker;

type TinypoolModule = {
    readonly Tinypool: TinypoolConstructor;
};

const require = createRequire(import.meta.url);

function isTinypoolModule(value: unknown): value is TinypoolModule {
    return typeof value === 'object' &&
        value !== null &&
        typeof Reflect.get(value, 'Tinypool') === 'function';
}

export function loadTinypoolConstructor(): TinypoolConstructor {
    const moduleValue: unknown = require('tinypool');

    if (!isTinypoolModule(moduleValue)) {
        throw new Error('Tinypool module did not expose the Tinypool constructor.');
    }

    return moduleValue.Tinypool;
}
