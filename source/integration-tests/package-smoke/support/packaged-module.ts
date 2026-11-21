import { realpath } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod/v4';

export const packageSmokeDirectory = resolve('target/package-smoke');
export const packageSmokeNodeModules = join(packageSmokeDirectory, 'node_modules');
const packedModules = await realpath(packageSmokeNodeModules);
const resolver = z
    .object({
        resolvePackage: z.custom<(specifier: string) => string>(function isPackageResolver(value) {
            return typeof value === 'function';
        })
    })
    .parse(await import(pathToFileURL(join(packageSmokeDirectory, 'resolver.mjs')).href));

function isPackedModule(url: string): boolean {
    if (!url.startsWith('file:')) {
        return false;
    }
    const location = relative(packedModules, fileURLToPath(url));
    return !isAbsolute(location) && location.split(sep)[0] !== '..';
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        if (
            context.parentURL !== undefined && isPackedModule(context.parentURL) &&
            result.url.startsWith('file:') && !specifier.startsWith('file:') && !isAbsolute(specifier) &&
            !isPackedModule(result.url)
        ) {
            throw new Error(`Packed package resolved an uninstalled dependency: ${specifier}`);
        }
        return result;
    }
});

export async function resolvePackagedExport(specifier: string): Promise<string> {
    const entry = resolver.resolvePackage(specifier);
    const resolved = pathToFileURL(await realpath(fileURLToPath(entry))).href;
    if (!isPackedModule(resolved)) {
        throw new Error(`Consumer package resolved outside the packed installation: ${specifier}`);
    }
    return resolved;
}
