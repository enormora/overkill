import * as namespace from 'node:path';
import type {
    RegisterHooksOptions,
    ResolveHookContext,
    LoadHookContext,
    ResolveFnOutput,
    LoadFnOutput
} from 'node:module';
import type { ModuleLoadingRuntime } from '../module-delivery.ts';

export type ModuleLoadingFixture = {
    readonly runtime: ModuleLoadingRuntime;
    readonly registrations: readonly RegisterHooksOptions[];
    readonly imports: readonly string[];
    readonly namespace: typeof namespace;
    readonly resolve: (specifier: string, parentURL: string | undefined) => ResolveFnOutput;
    readonly load: (url: string) => LoadFnOutput;
};
export function moduleLoadingRuntime(): ModuleLoadingFixture {
    const registrations: RegisterHooksOptions[] = [];
    const imports: string[] = [];
    const root = {};
    function resolveAt(index: number, specifier: string, context: ResolveHookContext): ResolveFnOutput {
        const hook = registrations[index]?.resolve;
        if (index < 0) {
            if (specifier.startsWith('.')) {
                const url = new URL(specifier, context.parentURL);
                return { url: url.href };
            }
            return { url: specifier };
        }
        return hook === undefined
            ? resolveAt(index - 1, specifier, context)
            : hook(specifier, context, function (next, overrides) {
                return resolveAt(index - 1, next, { ...context, ...overrides });
            });
    }
    function loadAt(index: number, url: string, context: LoadHookContext): LoadFnOutput {
        const hook = registrations[index]?.load;
        if (index < 0) {
            return { format: 'module', source: 'native source' };
        }
        return hook === undefined ? loadAt(index - 1, url, context) : hook(url, context, function (next, overrides) {
            return loadAt(index - 1, next, { ...context, ...overrides });
        });
    }
    function resolve(specifier: string, parentURL: string | undefined): ResolveFnOutput {
        return resolveAt(registrations.length - 1, specifier, { conditions: [], importAttributes: {}, parentURL });
    }
    function load(url: string): LoadFnOutput {
        return loadAt(registrations.length - 1, url, { conditions: [], importAttributes: {}, format: 'module' });
    }
    const runtime: ModuleLoadingRuntime = {
        root,
        register(hooks) {
            registrations.push(hooks);
            return {
                deregister() {
                    registrations.splice(registrations.indexOf(hooks), 1);
                }
            };
        },
        resolve(specifier) {
            return resolve(specifier, undefined).url;
        },
        async load(url) {
            imports.push(url);
            resolve(url, undefined);
            load(url);
            return { namespace };
        }
    };
    return { runtime, registrations, imports, resolve, load, namespace };
}
