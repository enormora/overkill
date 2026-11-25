/* eslint node/no-sync: "off" -- The native compiler requires synchronous filesystem callbacks. */
import { readFileSync, existsSync, readdirSync, realpathSync, statSync, type Stats } from 'node:fs';
import type { FileSystemStat } from 'typescript-beta/fs';

function missing(error: unknown): boolean {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : null;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
function readFile(path: string): string | undefined {
    try {
        return readFileSync(path, 'utf8');
    } catch (error) {
        if (missing(error)) {
            return undefined;
        }
        throw error;
    }
}
function fileStatus(path: string, ignoreErrors: 'all' | 'missing'): Stats | undefined {
    try {
        return statSync(path, { throwIfNoEntry: false });
    } catch (error: unknown) {
        if (ignoreErrors === 'all' || missing(error)) {
            return undefined;
        }
        throw error;
    }
}
function directoryExists(path: string): boolean {
    return fileStatus(path, 'missing')?.isDirectory() ?? false;
}
function entries(path: string): string[] {
    try {
        return readdirSync(path).toSorted(function byName(left, right) {
            return left.localeCompare(right);
        });
    } catch (error) {
        if (missing(error)) {
            return [];
        }
        throw error;
    }
}
function realpath(path: string): string {
    return existsSync(path) ? realpathSync(path) : path;
}
function stat(path: string): FileSystemStat | undefined {
    const value = fileStatus(path, 'missing');
    return value === undefined ? undefined : { mode: value.mode, size: value.size, mtime: value.mtime };
}
export const compilerFileSystem = {
    readFile,
    directoryExists,
    entries,
    realpath,
    stat,
    fileExists(path: string): boolean {
        const value = fileStatus(path, 'all');
        return value !== undefined && !value.isDirectory();
    }
};
