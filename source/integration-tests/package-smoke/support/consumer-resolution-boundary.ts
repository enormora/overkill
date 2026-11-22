import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

async function installedPackageNames(directory: string): Promise<readonly string[]> {
    try {
        const entries = await readdir(directory, { withFileTypes: true });
        const packages = entries.filter(function packageDirectory(entry) {
            return !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink());
        });
        const names = await Promise.all(packages.map(async function packageNames(entry) {
            if (!entry.name.startsWith('@')) {
                return [ entry.name ];
            }
            const scoped = await readdir(join(directory, entry.name));
            return scoped.map(function qualifiedName(name) {
                return `${entry.name}/${name}`;
            });
        }));
        return names.flat();
    } catch (error) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

function ancestorDirectories(directory: string): readonly string[] {
    const ancestors: string[] = [];
    let current = dirname(resolve(directory));
    let parent = dirname(current);
    while (parent !== current) {
        ancestors.push(current);
        current = parent;
        parent = dirname(current);
    }
    return [ ...ancestors, current ];
}

async function rejectAncestorPackage(modules: string, name: string): Promise<void> {
    const directory = join(modules, name);
    await mkdir(dirname(directory), { recursive: true });
    try {
        await mkdir(directory);
    } catch (error) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'EEXIST') {
            return;
        }
        throw error;
    }
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, exports: {} }));
}

export async function sealConsumerDependencies(directory: string): Promise<void> {
    const ancestors = await Promise.all(
        ancestorDirectories(directory).map(async function ancestorPackages(ancestor) {
            return await installedPackageNames(join(ancestor, 'node_modules'));
        })
    );
    const modules = join(directory, 'node_modules');
    await mkdir(modules, { recursive: true });
    await Promise.all(Array.from(new Set(ancestors.flat()), async function blockFallback(name) {
        await rejectAncestorPackage(modules, name);
    }));
}
