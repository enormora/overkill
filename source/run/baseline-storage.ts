import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { createNodeFileStore } from '../file-store.ts';
import { existingPathAncestor, isPathInside } from './path-containment.ts';
import { baselineFilename, storedOrdinaryBaselineSchema, type StoredOrdinaryBaseline } from './baseline-record.ts';

type StorageInput = { readonly root: string; readonly directory: string; readonly maxBytes: number; };
type BaselineStorage = {
    readonly checkDirectory: (directory: string) => Promise<void>;
    readonly location: (baseline: StoredOrdinaryBaseline) => string;
    readonly encoded: (baseline: StoredOrdinaryBaseline) => string;
    readonly read: (file: string) => Promise<StoredOrdinaryBaseline | null>;
};
const jsonIndentation = 2;
async function fileStats(file: string): Promise<Stats | null> {
    try {
        return await lstat(file);
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
export function createBaselineStorage(input: StorageInput): BaselineStorage {
    const files = createNodeFileStore();
    async function checkDirectory(selected: string): Promise<void> {
        if (!isPathInside(input.root, selected) || !isPathInside(input.root, await existingPathAncestor(selected))) {
            throw new Error('Baseline directory must remain inside the project root.');
        }
        const stats = await fileStats(selected);
        if (stats?.isSymbolicLink() === true) {
            throw new Error('Baseline directories cannot be symbolic links.');
        }
    }
    function location(baseline: StoredOrdinaryBaseline): string {
        return path.join(input.directory, baseline.subtype, baselineFilename(baseline));
    }
    function encoded(baseline: StoredOrdinaryBaseline): string {
        const content = `${JSON.stringify(storedOrdinaryBaselineSchema.parse(baseline), null, jsonIndentation)}\n`;
        if (Buffer.byteLength(content) > input.maxBytes) {
            throw new Error('Baseline exceeds the configured artifact byte limit.');
        }
        return content;
    }
    async function validateFile(file: string): Promise<boolean> {
        const stats = await fileStats(file);
        if (stats === null) {
            return false;
        }
        if (!stats.isFile() || stats.size > input.maxBytes) {
            throw new Error(`Invalid baseline file: ${path.basename(file)}`);
        }
        return true;
    }
    async function read(file: string): Promise<StoredOrdinaryBaseline | null> {
        await checkDirectory(path.dirname(file));
        if (!await validateFile(file)) {
            return null;
        }
        const content = await files.read(file);
        if (content === null) {
            throw new Error('Baseline disappeared while reading.');
        }
        const baseline = storedOrdinaryBaselineSchema.parse(JSON.parse(content));
        if (location(baseline) !== file) {
            throw new Error('Baseline path does not match its identity.');
        }
        return baseline;
    }
    return { checkDirectory, location, encoded, read };
}
