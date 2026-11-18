import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod/v4';
import type { BaselineChange } from '../baselines/baseline-model.ts';
import type { FileStore } from '../file-store.ts';
import { isPathInside } from './path-containment.ts';

type StorageInput<Baseline> = {
    readonly schema: z.ZodType<Baseline>;
    readonly relativePath: (baseline: Baseline) => string;
    readonly root: string;
    readonly directory: string;
    readonly maxBytes: number;
};
export type BaselineStorage<Baseline> = {
    readonly validate: (change: BaselineChange<Baseline>) => Promise<void>;
    readonly apply: (change: BaselineChange<Baseline>) => Promise<void>;
    readonly checkDirectory: (directory: string) => Promise<void>;
    readonly location: (baseline: Baseline) => string;
    readonly encoded: (baseline: Baseline) => string;
    readonly read: (file: string) => Promise<Baseline | null>;
};
const jsonIndentation = 2;
export type BaselineFileStatus = { readonly file: boolean; readonly link: boolean; readonly size: number; };
export type BaselineStorageAccess = {
    readonly files: FileStore;
    readonly remove: (path: string) => Promise<void>;
    readonly ancestor: (path: string) => Promise<string>;
    readonly inspect: (path: string) => Promise<BaselineFileStatus | null>;
};
export async function baselineFileStatus(file: string): Promise<BaselineFileStatus | null> {
    try {
        const stats = await lstat(file);
        return { file: stats.isFile(), link: stats.isSymbolicLink(), size: stats.size };
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
export function createBaselineStorage<Baseline>(
    input: StorageInput<Baseline>,
    access: BaselineStorageAccess
): BaselineStorage<Baseline> {
    async function checkDirectory(selected: string): Promise<void> {
        if (!isPathInside(input.root, selected) || !isPathInside(input.root, await access.ancestor(selected))) {
            throw new Error('Baseline directory must remain inside the project root.');
        }
        const stats = await access.inspect(selected);
        if (stats?.link === true) {
            throw new Error('Baseline directories cannot be symbolic links.');
        }
    }
    function location(baseline: Baseline): string {
        return path.join(input.directory, input.relativePath(baseline));
    }
    function encoded(baseline: Baseline): string {
        const content = `${JSON.stringify(input.schema.parse(baseline), null, jsonIndentation)}\n`;
        if (Buffer.byteLength(content) > input.maxBytes) {
            throw new Error('Baseline exceeds the configured artifact byte limit.');
        }
        return content;
    }
    async function validateFile(file: string): Promise<boolean> {
        const stats = await access.inspect(file);
        if (stats === null) {
            return false;
        }
        if (!stats.file || stats.size > input.maxBytes) {
            throw new Error(`Invalid baseline file: ${path.basename(file)}`);
        }
        return true;
    }
    async function read(file: string): Promise<Baseline | null> {
        await checkDirectory(path.dirname(file));
        if (!await validateFile(file)) {
            return null;
        }
        const content = await access.files.read(file);
        if (content === null) {
            throw new Error('Baseline disappeared while reading.');
        }
        const baseline = input.schema.parse(JSON.parse(content));
        if (location(baseline) !== file) {
            throw new Error('Baseline path does not match its identity.');
        }
        return baseline;
    }
    async function validate(change: BaselineChange<Baseline>): Promise<void> {
        await checkDirectory(input.directory);
        const current = await read(location(change.baseline));
        const previous = change.kind === 'update' ? change.previous : change.baseline;
        const expected = change.kind === 'create' ? null : input.schema.parse(previous);
        if (JSON.stringify(current) !== JSON.stringify(expected)) {
            throw new Error('Baseline changed during execution. Run the command again.');
        }
        if (change.kind !== 'remove') {
            encoded(change.baseline);
        }
    }
    async function apply(change: BaselineChange<Baseline>): Promise<void> {
        await validate(change);
        const file = location(change.baseline);
        if (change.kind === 'remove') {
            await access.remove(file);
        } else if (change.kind === 'create') {
            await access.files.create(file, encoded(change.baseline));
        } else {
            await access.files.write(file, encoded(change.baseline));
        }
    }
    return { checkDirectory, location, encoded, read, validate, apply };
}
