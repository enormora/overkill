import { posix as path } from 'node:path';

export function matchesBaselineSourcePath(file: string | null, paths: readonly string[]): boolean {
    if (paths.length === 0) {
        return true;
    }
    if (file === null) {
        return false;
    }
    return paths.some(function matchesPath(operand) {
        const normalized = path.normalize(operand.replaceAll('\\', '/')).replace(/\/$/u, '');
        return file === normalized || file.startsWith(`${normalized}/`) || path.matchesGlob(file, normalized);
    });
}
