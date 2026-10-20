import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { CalibrationSnapshot } from '../engine/benchmark-result.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { createNodeFileStore, type FileStore } from '../file-store.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import { isPathInside, existingPathAncestor } from '../run/path-containment.ts';
import { storedCalibrationSchema, type StoredCalibration } from './calibration-reference.ts';

export type CalibrationStoreInput = {
    readonly projectRoot: string;
    readonly directory: string;
    readonly maxBytes: number;
};
export type CalibrationReferenceStore = {
    readonly list: () => Promise<readonly StoredCalibration[]>;
    readonly pathOf: (reference: StoredCalibration) => string;
    readonly remove: (references: readonly StoredCalibration[]) => Promise<readonly string[]>;
    readonly write: (
        profile: string,
        snapshots: readonly CalibrationSnapshot[],
        owners: (snapshot: CalibrationSnapshot) => StoredCalibration['owners']
    ) => Promise<readonly string[]>;
};
type StoreLocation = {
    readonly root: string;
    readonly directory: string;
    readonly maxBytes: number;
    readonly files: FileStore;
};
type ReferenceFile = { readonly name: string; readonly content: string; };
type PublicationFailure = { readonly cause: unknown; readonly completed: readonly string[]; };
export class CalibrationPublicationError extends Error {
    private readonly completedPaths: readonly string[];
    public constructor(message: string, options: PublicationFailure) {
        super(message, options);
        this.name = 'CalibrationPublicationError';
        this.completedPaths = options.completed;
    }

    public completed(): readonly string[] {
        return this.completedPaths;
    }
}
function calibrationFilename(profile: string, snapshot: CalibrationSnapshot): string {
    const identity = canonicalIdentityJson([ profile, snapshot.machineClass, snapshot.identity ]);
    return `${createHash('sha256').update(identity).digest('hex')}.calibration.json`;
}
function referencePath(location: StoreLocation, reference: StoredCalibration): string {
    return path
        .relative(
            location.root,
            path.join(location.directory, calibrationFilename(reference.profile, reference.snapshot))
        )
        .replaceAll('\\', '/');
}
function missingFile(error: unknown): boolean {
    return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}
async function existingRoot(root: string): Promise<string | null> {
    try {
        return await realpath(root);
    } catch (error: unknown) {
        if (missingFile(error)) {
            return null;
        }
        throw error;
    }
}
async function validateDirectory(location: StoreLocation, physicalRoot: string): Promise<void> {
    if (
        !isPathInside(location.root, location.directory) ||
        !isPathInside(physicalRoot, await existingPathAncestor(location.directory))
    ) {
        throw new TypeError('Calibration reference directory must remain inside the project root.');
    }
}
async function referenceNames(directory: string): Promise<readonly string[]> {
    try {
        return await readdir(directory);
    } catch (error: unknown) {
        if (missingFile(error)) {
            return [];
        }
        throw error;
    }
}
async function readReference(location: StoreLocation, name: string): Promise<StoredCalibration> {
    const file = path.join(location.directory, name);
    const stats = await lstat(file);
    if (!stats.isFile() || stats.size > location.maxBytes) {
        throw new TypeError('Calibration reference is not a bounded regular file.');
    }
    const content = await location.files.read(file);
    const value: unknown = content === null ? null : JSON.parse(content);
    const stored = storedCalibrationSchema.parse(value);
    if (calibrationFilename(stored.profile, stored.snapshot) !== name) {
        throw new TypeError('Calibration reference filename does not match its identity.');
    }
    return stored;
}
async function readReferences(location: StoreLocation): Promise<readonly StoredCalibration[]> {
    const physicalRoot = await existingRoot(location.root);
    if (physicalRoot === null) {
        return [];
    }
    await validateDirectory(location, physicalRoot);
    const names = await referenceNames(location.directory);
    const selected = names
        .filter(function referenceFile(name) {
            return name.endsWith('.calibration.json');
        })
        .toSorted(function alphabetical(left, right) {
            return left.localeCompare(right);
        });
    return await Promise.all(selected.map(async function reference(name) {
        return await readReference(location, name);
    }));
}
function encodedReferences(
    location: StoreLocation,
    profile: string,
    snapshots: readonly CalibrationSnapshot[],
    owners: (snapshot: CalibrationSnapshot) => StoredCalibration['owners']
): readonly ReferenceFile[] {
    return snapshots.map(function encodeReference(snapshot) {
        const stored = storedCalibrationSchema.parse({ profile, snapshot, owners: owners(snapshot), version: 1 });
        const encoded = snapshotJson(stored, location.maxBytes);
        if (encoded === null) {
            throw new TypeError('Calibration reference exceeds the configured artifact byte limit.');
        }
        return { name: calibrationFilename(profile, snapshot), content: encoded.encoded };
    });
}
async function publishFiles(
    location: StoreLocation,
    pending: readonly ReferenceFile[],
    record: (path: string) => void
): Promise<void> {
    for (const file of pending) {
        await location.files.write(path.join(location.directory, file.name), file.content);
        record(path.relative(location.root, path.join(location.directory, file.name)).replaceAll('\\', '/'));
    }
}
async function publishReferences(
    location: StoreLocation,
    pending: readonly ReferenceFile[]
): Promise<readonly string[]> {
    await validateDirectory(location, await realpath(location.root));
    await mkdir(location.directory, { recursive: true });
    await validateDirectory(location, await realpath(location.root));
    const written: string[] = [];
    try {
        await publishFiles(location, pending, function writtenPath(filePath) {
            written.push(filePath);
        });
    } catch (error: unknown) {
        throw new CalibrationPublicationError('Calibration reference publication failed.', {
            cause: error,
            completed: written
        });
    }
    return written;
}
async function removeFiles(
    location: StoreLocation,
    references: readonly StoredCalibration[],
    record: (path: string) => void
): Promise<void> {
    for (const reference of references) {
        const name = calibrationFilename(reference.profile, reference.snapshot);
        const current = await readReference(location, name);
        if (canonicalIdentityJson(current) !== canonicalIdentityJson(reference)) {
            throw new Error('Calibration reference changed during execution.');
        }
        await unlink(path.join(location.directory, name));
        record(referencePath(location, reference));
    }
}
async function removeReferences(
    location: StoreLocation,
    references: readonly StoredCalibration[]
): Promise<readonly string[]> {
    await validateDirectory(location, await realpath(location.root));
    for (const reference of references) {
        const current = await readReference(location, calibrationFilename(reference.profile, reference.snapshot));
        if (canonicalIdentityJson(current) !== canonicalIdentityJson(reference)) {
            throw new Error('Calibration reference changed during execution.');
        }
    }
    const removed: string[] = [];
    try {
        await removeFiles(location, references, function removedPath(filePath) {
            removed.push(filePath);
        });
    } catch (error: unknown) {
        throw new CalibrationPublicationError('Calibration reference removal failed.', {
            cause: error,
            completed: removed
        });
    }
    return removed;
}
export async function createCalibrationReferenceStore(
    input: CalibrationStoreInput
): Promise<CalibrationReferenceStore> {
    const root = path.resolve(input.projectRoot);
    const location = {
        root,
        directory: path.resolve(root, input.directory, 'calibration'),
        maxBytes: input.maxBytes,
        files: createNodeFileStore()
    };
    if (!isPathInside(root, location.directory)) {
        throw new TypeError('Calibration reference directory must remain inside the project root.');
    }
    return {
        async list() {
            return await readReferences(location);
        },
        pathOf(reference) {
            return referencePath(location, reference);
        },
        async remove(references) {
            return await removeReferences(location, references);
        },
        async write(profile, snapshots, owners) {
            return await publishReferences(location, encodedReferences(location, profile, snapshots, owners));
        }
    };
}
