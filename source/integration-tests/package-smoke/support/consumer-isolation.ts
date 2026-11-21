import { realpath } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = await realpath(process.env.OVERKILL_PACKAGE_SMOKE_ROOT ?? process.cwd());
const modules = resolve(directory, 'node_modules');
const roots = [ directory ];
try {
    roots.push(await realpath(modules));
} catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
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
        if (specifier.startsWith('file:') || context.parentURL === undefined || !isConsumerFile(context.parentURL)) {
            return resolved;
        }
        throw new Error(`Consumer resolved an uninstalled dependency: ${specifier}`);
    }
});
