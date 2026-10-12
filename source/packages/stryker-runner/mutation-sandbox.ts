import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FileDescriptions } from '@stryker-mutator/api/core';
import { z } from 'zod/v4';
import { ConfigError } from '../run/config.entry-point.ts';
import type { FileModuleBoundary } from '../run/run.entry-point.ts';
import type { OverkillRunnerOptions } from './runner-options.ts';

export const mutationSandboxSchema = z
    .strictObject({
        originalRoot: z.string().min(1),
        root: z.string().min(1),
        sharedRoots: z.array(z.string()).readonly(),
        files: z.array(z.strictObject({ file: z.string().min(1), mutationTarget: z.boolean() }).readonly()).readonly()
    })
    .readonly();

export type MutationSandbox = z.output<typeof mutationSandboxSchema>;

type MutationSandboxInput = {
    readonly originalRoot: string;
    readonly cwd: string;
    readonly fileDescriptions: FileDescriptions;
};

function projectRelativePath(root: string, path: string): string | null {
    const file = relative(root, path);
    return file === '..' || file.startsWith(`..${sep}`) || isAbsolute(file) ? null : file;
}

function originalFiles(root: string, descriptions: FileDescriptions): MutationSandbox['files'] {
    const seen = new Set<string>();
    return Object.entries(descriptions).map(function describeOriginalFile([ path, description ]) {
        const file = projectRelativePath(root, path);
        if (!isAbsolute(path) || file === null || file === '' || seen.has(file)) {
            throw new ConfigError(`Invalid Stryker project file origin: ${path}`);
        }
        seen.add(file);
        return { file: file.replaceAll('\\', '/'), mutationTarget: description.mutate !== false };
    });
}

async function existingModulePath(path: string): Promise<string | null> {
    try {
        return await realpath(path);
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function sharedModuleRoots(
    root: string,
    originalRoot: string,
    files: MutationSandbox['files']
): Promise<readonly string[]> {
    const bootstrapRoot = dirname(dirname(import.meta.dirname));
    const roots = [ root, bootstrapRoot ].flatMap(function moduleSearchRoots(directory) {
        return createRequire(pathToFileURL(resolve(directory, 'package.json'))).resolve.paths('overkill') ?? [];
    });
    const existingRoots = await Promise.all([ bootstrapRoot, ...roots ].map(existingModulePath));
    const sharedRoots = Array.from(
        new Set(
            existingRoots
                .filter(function existingRoot(path) {
                    return path !== null;
                })
                .filter(function externalModuleRoot(path) {
                    return projectRelativePath(root, path) === null;
                })
        )
    );
    for (const sharedRoot of sharedRoots) {
        if (projectRelativePath(sharedRoot, originalRoot) !== null) {
            throw new ConfigError(`Shared module root contains the original project: ${sharedRoot}`);
        }
        if (
            files.some(function sharedProjectFile(file) {
                return projectRelativePath(sharedRoot, resolve(originalRoot, file.file)) !== null;
            })
        ) {
            throw new ConfigError(`Shared module root overlaps Stryker project files: ${sharedRoot}`);
        }
    }
    return sharedRoots;
}

export async function createMutationSandbox(input: MutationSandboxInput): Promise<MutationSandbox> {
    const root = await realpath(input.cwd);
    const files = originalFiles(input.originalRoot, input.fileDescriptions);
    const sharedRoots = await sharedModuleRoots(root, input.originalRoot, files);
    return mutationSandboxSchema.parse({
        originalRoot: input.originalRoot,
        root,
        sharedRoots,
        files
    });
}

export function sandboxModuleBoundary(sandbox: MutationSandbox): FileModuleBoundary {
    return { projectRoot: sandbox.root, sharedRoots: sandbox.sharedRoots };
}

function sandboxPath(sandbox: MutationSandbox, input: string): string {
    const path = input.startsWith('file:') ? fileURLToPath(input) : input;
    const originalFile = isAbsolute(path) && projectRelativePath(sandbox.root, path) === null
        ? projectRelativePath(sandbox.originalRoot, path)
        : null;
    const candidate = resolve(sandbox.root, originalFile ?? path);
    if (projectRelativePath(sandbox.root, candidate) === null) {
        throw new ConfigError(`Overkill path escapes the Stryker sandbox: ${input}`);
    }
    return candidate;
}

export function sandboxRunnerOptions(
    sandbox: MutationSandbox,
    settings: OverkillRunnerOptions
): OverkillRunnerOptions {
    return {
        ...settings,
        configPath: settings.configPath === null ? null : sandboxPath(sandbox, settings.configPath),
        paths: settings.paths.map(function sandboxRunPath(path) {
            return sandboxPath(sandbox, path);
        })
    };
}

async function sandboxFileOrigin(sandbox: MutationSandbox, path: string): Promise<string> {
    const canonicalPath = await existingModulePath(path) ?? path;
    const file = projectRelativePath(sandbox.root, canonicalPath);
    if (file === null) {
        throw new ConfigError(`Mutation target escapes the Stryker sandbox: ${path}`);
    }
    return file.replaceAll('\\', '/');
}

export async function assertExcludedMutationFiles(
    sandbox: MutationSandbox,
    paths: readonly string[],
    role: string
): Promise<void> {
    const targets = sandbox.files.filter(function mutationTarget(file) {
        return file.mutationTarget;
    });
    const selected = new Set(
        await Promise.all(targets.map(async function targetOrigin(file) {
            return sandboxFileOrigin(sandbox, resolve(sandbox.root, file.file));
        }))
    );
    const origins = await Promise.all(paths.map(async function protectedOrigin(path) {
        return sandboxFileOrigin(sandbox, path);
    }));
    const conflicts = origins.filter(function selectedFile(file) {
        return selected.has(file);
    });
    if (conflicts.length > 0) {
        throw new ConfigError(`Exclude ${role} from Stryker mutate: ${conflicts.join(', ')}`);
    }
}

export async function assertExcludedAdapter(sandbox: MutationSandbox): Promise<void> {
    const directory = projectRelativePath(sandbox.originalRoot, import.meta.dirname);
    if (directory === null) {
        return;
    }
    const paths = sandbox
        .files
        .filter(function adapterFile(file) {
            const path = resolve(sandbox.originalRoot, file.file);
            return projectRelativePath(import.meta.dirname, path) !== null;
        })
        .map(function sandboxAdapterFile(file) {
            return resolve(sandbox.root, file.file);
        });
    await assertExcludedMutationFiles(sandbox, paths, 'adapter code');
}
