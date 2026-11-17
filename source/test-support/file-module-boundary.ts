import { createModuleLoading } from '../module-delivery.ts';
import type { FileBoundaryAccess } from '../run/file-module-boundary.ts';
import { moduleLoadingRuntime, type ModuleLoadingFixture } from './module-loading-runtime.ts';

type ModuleBoundaryFixture = ModuleLoadingFixture & {
    readonly access: FileBoundaryAccess;
    readonly canonicalized: readonly string[];
};
export function fileModuleBoundary(links: Readonly<Record<string, string>>): ModuleBoundaryFixture {
    const platform = moduleLoadingRuntime();
    const loading = createModuleLoading(platform.runtime);
    const canonicalized: string[] = [];
    return {
        ...platform,
        canonicalized,
        access: {
            async canonical(target) {
                canonicalized.push(target);
                return links[target] ?? target;
            },
            canonicalFile(target) {
                canonicalized.push(target);
                return links[target] ?? target;
            },
            loading: loading.withModuleLoadingScope
        }
    };
}
