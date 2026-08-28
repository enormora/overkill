import { glob, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import {
    invalidProfileFileGlobMessage,
    type ProfileFileGlobField
} from './profile-file-glob.ts';
import { invalidRequest, noTestsCollected } from './run-errors.ts';
import type { RunProfileFiles } from './run-types.ts';

export type RunDiscoveryRequest = {
    readonly cwd: string;
    readonly paths: readonly string[];
    readonly profileFiles: RunProfileFiles | null;
};

export type DiscoveredRunFile = {
    readonly file: string;
    readonly href: string;
    readonly path: string;
};

type DiscoveredRunDirectory = {
    readonly path: string;
    readonly requestedPath: string;
};

type DiscoveredRunPath = {
    readonly directory: DiscoveredRunDirectory;
    readonly kind: 'directory';
} | {
    readonly file: DiscoveredRunFile;
    readonly kind: 'file';
};

function toFileIdentity(path: string): string {
    return path.replaceAll('\\', '/');
}

function isOutsideCwd(relativePath: string): boolean {
    return relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath);
}

function assertInsideCwd(realCwd: string, realPath: string, requestedPath: string): void {
    if (isOutsideCwd(relative(realCwd, realPath))) {
        invalidRequest(`Run path must stay inside cwd: ${requestedPath}`);
    }
}

async function readRealCwd(cwd: string): Promise<string> {
    try {
        return await realpath(cwd);
    } catch {
        return invalidRequest(`Run cwd does not exist: ${cwd}`);
    }
}

function assertValidProfileGlob(field: ProfileFileGlobField, pattern: string): void {
    const message = invalidProfileFileGlobMessage(field, pattern);

    if (message !== null) {
        invalidRequest(message);
    }
}

function assertValidProfileFiles(profileFiles: RunProfileFiles): void {
    for (const pattern of profileFiles.include) {
        assertValidProfileGlob('include', pattern);
    }

    for (const pattern of profileFiles.exclude) {
        assertValidProfileGlob('exclude', pattern);
    }
}

async function readRealFilePath(cwd: string, requestedPath: string): Promise<string> {
    if (requestedPath.trim().length === 0) {
        invalidRequest('Run path must not be empty.');
    }

    try {
        return await realpath(resolve(cwd, requestedPath));
    } catch {
        return invalidRequest(`Run path does not exist: ${requestedPath}`);
    }
}

function createDiscoveredRunDirectory(
    realCwd: string,
    realPath: string,
    requestedPath: string
): DiscoveredRunDirectory {
    assertInsideCwd(realCwd, realPath, requestedPath);

    return {
        path: realPath,
        requestedPath
    };
}

function createDiscoveredRunFile(realCwd: string, realPath: string, requestedPath: string): DiscoveredRunFile {
    const relativePath = relative(realCwd, realPath);

    if (isOutsideCwd(relativePath)) {
        invalidRequest(`Run path must stay inside cwd: ${requestedPath}`);
    }

    return {
        file: toFileIdentity(relativePath),
        href: pathToFileURL(realPath).href,
        path: realPath
    };
}

async function assertRealFile(realPath: string, requestedPath: string): Promise<void> {
    const fileStat = await stat(realPath);

    if (!fileStat.isFile()) {
        invalidRequest(`Run path must be a file: ${requestedPath}`);
    }
}

async function discoverRunPath(
    realCwd: string,
    requestedPath: string
): Promise<DiscoveredRunPath> {
    const realPath = await readRealFilePath(realCwd, requestedPath);
    const pathStat = await stat(realPath);

    if (pathStat.isFile()) {
        return {
            file: createDiscoveredRunFile(realCwd, realPath, requestedPath),
            kind: 'file'
        };
    }

    if (pathStat.isDirectory()) {
        return {
            directory: createDiscoveredRunDirectory(realCwd, realPath, requestedPath),
            kind: 'directory'
        };
    }

    return invalidRequest(`Run path must be a file or directory: ${requestedPath}`);
}

function assertNonEmptyArray<Item>(
    message: string,
    values: readonly Item[]
): asserts values is NonEmptyReadonlyArray<Item> {
    if (values.length === 0) {
        noTestsCollected(message);
    }
}

async function discoverRunFile(
    realCwd: string,
    requestedPath: string
): Promise<DiscoveredRunFile> {
    const realPath = await readRealFilePath(realCwd, requestedPath);

    await assertRealFile(realPath, requestedPath);

    return createDiscoveredRunFile(realCwd, realPath, requestedPath);
}

function assertUniqueRunFile(file: DiscoveredRunFile, seenPaths: ReadonlySet<string>): void {
    if (seenPaths.has(file.path)) {
        invalidRequest(`Run path must not be duplicated: ${file.file}`);
    }
}

function sortedRunFiles(files: readonly DiscoveredRunFile[]): readonly DiscoveredRunFile[] {
    return Array.from(files).toSorted(function compareRunFiles(left, right) {
        return left.file.localeCompare(right.file);
    });
}

function uniqueRunFiles(files: readonly DiscoveredRunFile[]): readonly DiscoveredRunFile[] {
    const seenPaths = new Set<string>();

    return files.reduce<DiscoveredRunFile[]>(function appendUniqueFile(uniqueFiles, file) {
        if (seenPaths.has(file.path)) {
            return uniqueFiles;
        }

        seenPaths.add(file.path);

        return [ ...uniqueFiles, file ];
    }, []);
}

async function maybeDiscoverProfileFile(
    realCwd: string,
    requestedPath: string
): Promise<DiscoveredRunFile | null> {
    const realPath = await realpath(resolve(realCwd, requestedPath));
    const pathStat = await stat(realPath);

    if (!pathStat.isFile()) {
        return null;
    }

    return createDiscoveredRunFile(realCwd, realPath, requestedPath);
}

async function discoverProfileRunFiles(
    realCwd: string,
    profileFiles: RunProfileFiles
): Promise<readonly DiscoveredRunFile[]> {
    assertValidProfileFiles(profileFiles);
    const files: DiscoveredRunFile[] = [];
    const discoveredPaths = glob(profileFiles.include, {
        cwd: realCwd,
        exclude: profileFiles.exclude,
        followSymlinks: false
    });

    for await (const filePath of discoveredPaths) {
        const file = await maybeDiscoverProfileFile(realCwd, filePath);

        if (file !== null) {
            files.push(file);
        }
    }

    return sortedRunFiles(uniqueRunFiles(files));
}

async function discoverExplicitRunFiles(
    realCwd: string,
    requestedPaths: readonly string[]
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    const files = await Promise.all(requestedPaths.map(async function discoverPath(requestedPath) {
        return await discoverRunFile(realCwd, requestedPath);
    }));
    const seenPaths = new Set<string>();

    for (const file of files) {
        assertUniqueRunFile(file, seenPaths);
        seenPaths.add(file.path);
    }

    assertNonEmptyArray('No explicit run paths were provided.', files);

    return files;
}

function pathIsInsideDirectory(filePath: string, directoryPath: string): boolean {
    const relativePath = relative(directoryPath, filePath);

    return relativePath === '' || !isOutsideCwd(relativePath);
}

function filterFilesByDirectory(
    files: readonly DiscoveredRunFile[],
    directory: DiscoveredRunDirectory
): readonly DiscoveredRunFile[] {
    return files.filter(function isInsideDirectory(file) {
        return pathIsInsideDirectory(file.path, directory.path);
    });
}

function assertEffectiveDirectoryFilter(
    directory: DiscoveredRunDirectory,
    profileFiles: readonly DiscoveredRunFile[],
    filteredFiles: readonly DiscoveredRunFile[]
): void {
    if (filteredFiles.length === 0) {
        noTestsCollected(`Directory run path matched no profile-discovered test files: ${directory.requestedPath}`);
    }

    if (filteredFiles.length === profileFiles.length) {
        invalidRequest(`Directory run path did not narrow profile file discovery: ${directory.requestedPath}`);
    }
}

function discoverDirectoryFilteredFiles(
    profileFiles: NonEmptyReadonlyArray<DiscoveredRunFile>,
    directories: NonEmptyReadonlyArray<DiscoveredRunDirectory>
): NonEmptyReadonlyArray<DiscoveredRunFile> {
    const files: DiscoveredRunFile[] = [];

    for (const directory of directories) {
        const directoryFiles = filterFilesByDirectory(profileFiles, directory);
        assertEffectiveDirectoryFilter(directory, profileFiles, directoryFiles);
        files.push(...directoryFiles);
    }

    const uniqueFiles = sortedRunFiles(uniqueRunFiles(files));
    assertNonEmptyArray('Directory run paths matched no profile-discovered test files.', uniqueFiles);

    return [ uniqueFiles[0], ...uniqueFiles.slice(1) ];
}

function assertNoDuplicateDirectories(directories: readonly DiscoveredRunDirectory[]): void {
    const seenPaths = new Set<string>();

    for (const directory of directories) {
        if (seenPaths.has(directory.path)) {
            invalidRequest(`Run path must not be duplicated: ${directory.requestedPath}`);
        }

        seenPaths.add(directory.path);
    }
}

async function discoverDirectoryRunFiles(
    realCwd: string,
    profileFiles: RunProfileFiles | null,
    directories: NonEmptyReadonlyArray<DiscoveredRunDirectory>
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    if (profileFiles === null) {
        invalidRequest('Directory run paths require selected profile file discovery.');
    }

    assertNoDuplicateDirectories(directories);
    const files = await discoverProfileRunFiles(realCwd, profileFiles);
    assertNonEmptyArray('Profile file discovery matched no test files.', files);

    return discoverDirectoryFilteredFiles(files, directories);
}

async function discoverProfileOnlyRunFiles(
    realCwd: string,
    profileFiles: RunProfileFiles | null
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    if (profileFiles === null) {
        noTestsCollected('No run paths were provided and the selected profile has no file discovery policy.');
    }

    const files = await discoverProfileRunFiles(realCwd, profileFiles);
    assertNonEmptyArray('Profile file discovery matched no test files.', files);

    return [ files[0], ...files.slice(1) ];
}

function assertConsistentRunPathKinds(paths: readonly DiscoveredRunPath[]): void {
    const hasFiles = paths.some(function isFile(path) {
        return path.kind === 'file';
    });
    const hasDirectories = paths.some(function isDirectory(path) {
        return path.kind === 'directory';
    });

    if (hasFiles && hasDirectories) {
        invalidRequest('Run paths must not mix files and directories.');
    }
}

function discoveredFiles(paths: readonly DiscoveredRunPath[]): readonly DiscoveredRunFile[] {
    return paths.flatMap(function toFile(path) {
        return path.kind === 'file' ? [ path.file ] : [];
    });
}

function discoveredDirectories(paths: readonly DiscoveredRunPath[]): readonly DiscoveredRunDirectory[] {
    return paths.flatMap(function toDirectory(path) {
        return path.kind === 'directory' ? [ path.directory ] : [];
    });
}

async function discoverRequestedRunFiles(
    realCwd: string,
    request: RunDiscoveryRequest
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    const paths = await Promise.all(request.paths.map(async function discoverPath(requestedPath) {
        return await discoverRunPath(realCwd, requestedPath);
    }));

    assertConsistentRunPathKinds(paths);

    const files = discoveredFiles(paths);

    if (files.length > 0) {
        return await discoverExplicitRunFiles(realCwd, request.paths);
    }

    const directories = discoveredDirectories(paths);
    assertNonEmptyArray(
        'No run paths were provided and the selected profile has no file discovery policy.',
        directories
    );

    return await discoverDirectoryRunFiles(
        realCwd,
        request.profileFiles,
        [ directories[0], ...directories.slice(1) ]
    );
}

export async function discoverRunFiles(
    request: RunDiscoveryRequest
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    const realCwd = await readRealCwd(request.cwd);

    return request.paths.length === 0
        ? await discoverProfileOnlyRunFiles(realCwd, request.profileFiles)
        : await discoverRequestedRunFiles(realCwd, request);
}
