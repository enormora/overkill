import { realpath } from 'node:fs/promises';
// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Resolver hooks enforce the installed consumer boundary.
import { registerHooks } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = new URL(import.meta.url);
const directory = await realpath(hook.searchParams.get('root') ?? process.cwd());
const modules = resolve(directory, 'node_modules');
const roots = [ directory ];
try {
    roots.push(await realpath(modules));
} catch (error) {
    if (!(error instanceof Error && Object.hasOwn(error, 'code') && Reflect.get(error, 'code') === 'ENOENT')) {
        throw error;
    }
}

function isConsumerFile(url: string): boolean {
    if (!url.startsWith('file:')) {
        return false;
    }
    const resolved = fileURLToPath(url);
    return roots.some(function containsConsumer(root) {
        const location = relative(root, resolved);
        return !isAbsolute(location) && location.split(sep)[0] !== '..';
    });
}

function isExternalToolImport(specifier: string, parentURL: string | undefined): boolean {
    return specifier.startsWith('file:') || parentURL === undefined || !isConsumerFile(parentURL);
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (!resolved.url.startsWith('file:') || isConsumerFile(resolved.url)) {
            return resolved;
        }
        const dependency = fileURLToPath(resolved.url);
        if (dependency.includes(`${sep}node_modules${sep}@overkill-dev${sep}`)) {
            throw new Error(`Consumer resolved an uninstalled Overkill dependency: ${specifier}`);
        }
        if (isExternalToolImport(specifier, context.parentURL)) {
            return resolved;
        }
        throw new Error(`Consumer resolved an uninstalled dependency: ${specifier}`);
    }
});
