import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function resolvePackagedExport(specifier: string): Promise<string> {
    const entry = import.meta.resolve(specifier);
    const [ directory, resolved ] = await Promise.all([
        realpath(new URL('./node_modules/', import.meta.url)),
        realpath(fileURLToPath(entry))
    ]);
    const location = relative(directory, resolved);
    if (isAbsolute(location) || location.split(sep)[0] === '..') {
        throw new Error(`Consumer package resolved outside the packed installation: ${specifier}`);
    }
    return entry;
}
