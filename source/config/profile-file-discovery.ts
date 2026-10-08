import { resolve } from 'node:path';
import {
    invalidProfileFileGlobMessage,
    invalidProfileFileSetNameMessage
} from './profile-patterns.ts';
import type { ProfileFiles, ProfileFileSet } from './types.ts';

export type ConfiguredProfileFile = {
    readonly path: string;
    readonly fileSet: string | null;
};

type ProfileGlobOptions = {
    readonly cwd: string;
    readonly exclude: readonly string[];
    readonly followSymlinks: boolean;
};

type ProfilePathStats = { readonly isFile: () => boolean; };

type ProfileFileDiscoveryRequest = {
    readonly cwd: string;
    readonly files: ProfileFiles;
};

export type ProfileFileDiscoveryDependencies = {
    readonly glob: (pattern: string | readonly string[], options: ProfileGlobOptions) => AsyncIterable<string>;
    readonly realpath: (path: string) => Promise<string>;
    readonly stat: (path: string) => Promise<ProfilePathStats>;
};

type ProfileFileDiscoveryFailure = 'empty-set' | 'invalid-policy' | 'overlap';

export class ProfileFileDiscoveryError extends Error {
    private readonly failureReason: ProfileFileDiscoveryFailure;

    public constructor(
        message: string,
        options: Readonly<ErrorOptions> | undefined,
        reason: ProfileFileDiscoveryFailure
    ) {
        super(message, options);
        this.name = 'ProfileFileDiscoveryError';
        this.failureReason = reason;
    }

    public reason(): ProfileFileDiscoveryFailure {
        return this.failureReason;
    }
}

function validatePatterns(files: ProfileFileSet, fieldPrefix: string): void {
    const fields = [ 'include', 'exclude' ] as const;

    for (const field of fields) {
        const patterns = files[field];

        for (const pattern of patterns) {
            const message = invalidProfileFileGlobMessage(`${fieldPrefix}${field}`, pattern);

            if (message !== null) {
                throw new ProfileFileDiscoveryError(message, undefined, 'invalid-policy');
            }
        }
    }
}

function validateSets(sets: Readonly<Record<string, ProfileFileSet>>): void {
    const entries = Object.entries(sets);

    if (entries.length === 0) {
        throw new ProfileFileDiscoveryError(
            'Invalid profile files.sets: at least one file set is required.',
            undefined,
            'invalid-policy'
        );
    }

    for (const [ name, set ] of entries) {
        const message = invalidProfileFileSetNameMessage(name);

        if (message !== null) {
            throw new ProfileFileDiscoveryError(message, undefined, 'invalid-policy');
        }

        validatePatterns(set, `sets.${name}.`);
    }
}

function validateFiles(files: ProfileFiles): void {
    if (files.sets === undefined) {
        validatePatterns(files, '');
    } else {
        validateSets(files.sets);
    }
}

async function discoverPatterns(
    cwd: string,
    files: ProfileFileSet,
    fileSet: string | null,
    dependencies: ProfileFileDiscoveryDependencies
): Promise<readonly ConfiguredProfileFile[]> {
    const discovered = new Map<string, ConfiguredProfileFile>();
    const matches = dependencies.glob(files.include, { cwd, exclude: files.exclude, followSymlinks: false });

    for await (const match of matches) {
        const path = await dependencies.realpath(resolve(cwd, match));
        const stats = await dependencies.stat(path);

        if (stats.isFile()) {
            discovered.set(path, { path, fileSet });
        }
    }

    return Array.from(discovered.values()).toSorted(function compareProfileFiles(first, second) {
        return first.path.localeCompare(second.path);
    });
}

function validateSetOwnership(files: readonly ConfiguredProfileFile[]): void {
    const owners = new Map<string, string | null>();

    for (const file of files) {
        if (owners.has(file.path)) {
            throw new ProfileFileDiscoveryError(
                `Profile file sets must not overlap: ${file.path} matched ${
                    owners.get(file.path)
                } and ${file.fileSet}.`,
                undefined,
                'overlap'
            );
        }

        owners.set(file.path, file.fileSet);
    }
}

export async function discoverProfileFiles(
    request: ProfileFileDiscoveryRequest,
    dependencies: ProfileFileDiscoveryDependencies
): Promise<readonly ConfiguredProfileFile[]> {
    validateFiles(request.files);

    if (request.files.sets === undefined) {
        return await discoverPatterns(request.cwd, request.files, null, dependencies);
    }

    const sets = await Promise.all(
        Object.entries(request.files.sets).map(async function discoverSet([ name, files ]) {
            const matches = await discoverPatterns(request.cwd, files, name, dependencies);

            if (matches.length === 0) {
                throw new ProfileFileDiscoveryError(
                    `Profile files.sets.${name} matched no test files.`,
                    undefined,
                    'empty-set'
                );
            }

            return matches;
        })
    );
    const files = sets.flat();
    validateSetOwnership(files);

    return files.toSorted(function compareProfileFiles(first, second) {
        return first.path.localeCompare(second.path);
    });
}
