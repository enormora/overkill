import type { LoadFnOutput, RegisterHooksOptions, ResolveFnOutput, ResolveHookContext } from 'node:module';
import { withModuleHooks } from '../module-loading-scope.ts';
import type { runTask } from './worker-pool-worker.ts';

export type BootstrapModules = {
    readonly resolutions: ReadonlyMap<string, ResolveFnOutput>;
    readonly sources: ReadonlyMap<string, LoadFnOutput>;
};
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

function resolutionKey(specifier: string, context: ResolveHookContext): string {
    return JSON.stringify([ context.parentURL, specifier, context.conditions, context.importAttributes ]);
}

function isEsmFormat(format: string | null | undefined): boolean {
    return format === 'module' || format === 'module-typescript';
}

function reusableSource(url: string, loaded: LoadFnOutput): LoadFnOutput | null {
    const { source, format } = loaded;
    if (!isEsmFormat(format) || source === undefined || !url.startsWith('file:')) {
        return null;
    }
    return { format, source: typeof source === 'string' ? source : decoder.decode(source) };
}

type BootstrapModuleHooks = {
    readonly observed: BootstrapModules;
    readonly hooks: RegisterHooksOptions;
};

function bootstrapModuleHooks(cache: BootstrapModules | null): BootstrapModuleHooks {
    const resolutions = new Map<string, ResolveFnOutput>();
    const sources = new Map<string, LoadFnOutput>();
    const hooks: RegisterHooksOptions = {
        resolve(specifier, context, nextResolve) {
            const key = resolutionKey(specifier, context);
            const cached = cache?.resolutions.get(key);
            if (cached !== undefined) {
                return { ...cached, shortCircuit: true };
            }
            const resolution = nextResolve(specifier, context);
            if (cache === null && isEsmFormat(resolution.format) && resolution.url.startsWith('file:')) {
                resolutions.set(key, resolution);
            }
            return resolution;
        },
        load(url, context, nextLoad) {
            const key = JSON.stringify([ url, context.format, context.conditions, context.importAttributes ]);
            const cached = cache?.sources.get(key);
            if (cached !== undefined) {
                return { ...cached, shortCircuit: true };
            }
            const loaded = nextLoad(url, context);
            if (cache === null) {
                const source = reusableSource(url, loaded);
                if (source !== null) {
                    sources.set(key, source);
                }
            }
            return loaded;
        }
    };
    return { observed: { resolutions, sources }, hooks };
}

export async function loadWorkerBootstrap(cache: BootstrapModules | null): Promise<{
    readonly execute: typeof runTask;
    readonly modules: BootstrapModules | null;
}> {
    const { observed, hooks } = bootstrapModuleHooks(cache);
    const { runTask: execute } = await withModuleHooks(hooks, async function load() {
        return await import('./worker-pool-worker.ts');
    });
    return { execute, modules: cache === null ? observed : null };
}
