import path from 'node:path';

export function isPathInside(parent: string, candidate: string): boolean {
    const relativePath = path.relative(parent, candidate);
    const outsideParent = relativePath === '..' || relativePath.startsWith(`..${path.sep}`);

    return !outsideParent && !path.isAbsolute(relativePath);
}
