import { realpath } from 'node:fs/promises';
import path from 'node:path';

export function isPathInside(parent: string, candidate: string): boolean {
    const relativePath = path.relative(parent, candidate);
    const outsideParent = relativePath === '..' || relativePath.startsWith(`..${path.sep}`);

    return !outsideParent && !path.isAbsolute(relativePath);
}

export async function existingPathAncestor(candidate: string): Promise<string> {
    try {
        return await realpath(candidate);
    } catch (error: unknown) {
        const parent = path.dirname(candidate);
        if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'ENOENT' || parent === candidate) {
            throw error;
        }
        return await existingPathAncestor(parent);
    }
}
