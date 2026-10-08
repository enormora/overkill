import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverProfileFiles, ProfileFileDiscoveryError } from '../config/profile-file-discovery.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';

import type { ProfileFileSet, ProfileFiles } from '../config/types.ts';
import { invalidRequest, noTestsCollected } from './run-errors.ts';
import type {
    DiscoveredRunFile,
    DiscoveredRunFiles,
    RunDiscovery,
    RunDiscoveryDependencies,
    RunDiscoveryRequest
} from './run-discovery-types.ts';

type ProfileFileSets = {
    readonly sets: Readonly<Record<string, ProfileFileSet>>;
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

async function readRealCwd(cwd: string, dependencies: RunDiscoveryDependencies): Promise<string> {
    try {
        return await dependencies.realpath(cwd);
    } catch {
        return invalidRequest(`Run cwd does not exist: ${cwd}`);
    }
}

function hasProfileFileSets(profileFiles: ProfileFiles): profileFiles is ProfileFileSets {
    return profileFiles.sets !== undefined;
}

async function readRealFilePath(
    cwd: string,
    requestedPath: string,
    dependencies: RunDiscoveryDependencies
): Promise<string> {
    if (requestedPath.trim().length === 0) {
        invalidRequest('Run path must not be empty.');
    }

    try {
        return await dependencies.realpath(resolve(cwd, requestedPath));
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

function createDiscoveredRunFile(
    realCwd: string,
    realPath: string,
    requestedPath: string,
    fileSet: string | null
): DiscoveredRunFile {
    const relativePath = relative(realCwd, realPath);

    if (isOutsideCwd(relativePath)) {
        invalidRequest(`Run path must stay inside cwd: ${requestedPath}`);
    }

    return {
        fileSet,
        file: toFileIdentity(relativePath),
        href: pathToFileURL(realPath).href,
        path: realPath
    };
}

async function discoverRunPath(
    realCwd: string,
    requestedPath: string,
    dependencies: RunDiscoveryDependencies
): Promise<DiscoveredRunPath> {
    const realPath = await readRealFilePath(realCwd, requestedPath, dependencies);
    const pathStat = await dependencies.stat(realPath);

    if (pathStat.isFile()) {
        return {
            file: createDiscoveredRunFile(realCwd, realPath, requestedPath, null),
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

async function discoverProfileRunFiles(
    realCwd: string,
    profileFiles: ProfileFiles,
    dependencies: RunDiscoveryDependencies
): Promise<readonly DiscoveredRunFile[]> {
    try {
        const files = await discoverProfileFiles({ cwd: realCwd, files: profileFiles }, dependencies);

        return sortedRunFiles(files.map(function toRunFile(file) {
            return createDiscoveredRunFile(realCwd, file.path, file.path, file.fileSet);
        }));
    } catch (error: unknown) {
        if (error instanceof ProfileFileDiscoveryError) {
            if (error.reason() === 'empty-set') {
                return noTestsCollected(error.message);
            }

            return invalidRequest(error.message.replace(`${realCwd}/`, ''));
        }

        throw error;
    }
}

function explicitRunFileWithProfileFileSet(
    file: DiscoveredRunFile,
    fileSetByPath: ReadonlyMap<string, string> | null
): DiscoveredRunFile {
    if (fileSetByPath === null) {
        return file;
    }

    const fileSet = fileSetByPath.get(file.path);

    if (fileSet === undefined) {
        invalidRequest(`Run file must match exactly one profile file set: ${file.file}`);
    }

    return {
        ...file,
        fileSet
    };
}

function profileFileSetEntry(file: DiscoveredRunFile): readonly [string, string] {
    if (file.fileSet === null) {
        throw new Error('Expected profile-discovered file set.');
    }

    return [ file.path, file.fileSet ];
}

async function explicitFileSetByPath(
    realCwd: string,
    profileFiles: ProfileFiles | null,
    dependencies: RunDiscoveryDependencies
): Promise<ReadonlyMap<string, string> | null> {
    if (profileFiles === null || !hasProfileFileSets(profileFiles)) {
        return null;
    }

    const profileRunFiles = await discoverProfileRunFiles(realCwd, profileFiles, dependencies);

    return new Map(profileRunFiles.map(profileFileSetEntry));
}

function nonEmptyDiscoveredRunFiles(files: readonly DiscoveredRunFile[]): NonEmptyReadonlyArray<DiscoveredRunFile> {
    const firstFile = files[0];

    if (firstFile === undefined) {
        throw new Error('Expected at least one explicit run file.');
    }

    return [ firstFile, ...files.slice(1) ];
}

async function discoverExplicitRunFiles(
    realCwd: string,
    files: NonEmptyReadonlyArray<DiscoveredRunFile>,
    profileFiles: ProfileFiles | null,
    dependencies: RunDiscoveryDependencies
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    const seenPaths = new Set<string>();
    const explicitFiles: DiscoveredRunFile[] = [];
    const fileSetByPath = await explicitFileSetByPath(realCwd, profileFiles, dependencies);

    for (const file of files) {
        assertUniqueRunFile(file, seenPaths);
        seenPaths.add(file.path);
        explicitFiles.push(explicitRunFileWithProfileFileSet(file, fileSetByPath));
    }

    return nonEmptyDiscoveredRunFiles(explicitFiles);
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
    profileFiles: ProfileFiles | null,
    directories: NonEmptyReadonlyArray<DiscoveredRunDirectory>,
    dependencies: RunDiscoveryDependencies
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    if (profileFiles === null) {
        invalidRequest('Directory run paths require selected profile file discovery.');
    }

    assertNoDuplicateDirectories(directories);
    const files = await discoverProfileRunFiles(realCwd, profileFiles, dependencies);
    assertNonEmptyArray('Profile file discovery matched no test files.', files);

    return discoverDirectoryFilteredFiles(files, directories);
}

async function discoverProfileOnlyRunFiles(
    realCwd: string,
    profileFiles: ProfileFiles | null,
    dependencies: RunDiscoveryDependencies
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    if (profileFiles === null) {
        noTestsCollected('No run paths were provided and the selected profile has no file discovery policy.');
    }

    const files = await discoverProfileRunFiles(realCwd, profileFiles, dependencies);
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
    request: RunDiscoveryRequest,
    dependencies: RunDiscoveryDependencies
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    const paths = await Promise.all(request.paths.map(async function discoverPath(requestedPath) {
        return await discoverRunPath(realCwd, requestedPath, dependencies);
    }));

    assertConsistentRunPathKinds(paths);

    const files = discoveredFiles(paths);
    const firstFile = files[0];

    if (firstFile !== undefined) {
        return await discoverExplicitRunFiles(
            realCwd,
            [ firstFile, ...files.slice(1) ],
            request.profileFiles,
            dependencies
        );
    }

    const directories = discoveredDirectories(paths);
    assertNonEmptyArray(
        'No run paths were provided and the selected profile has no file discovery policy.',
        directories
    );

    return await discoverDirectoryRunFiles(
        realCwd,
        request.profileFiles,
        [ directories[0], ...directories.slice(1) ],
        dependencies
    );
}

export function createRunDiscovery(dependencies: RunDiscoveryDependencies): RunDiscovery {
    async function discoverRunFilesWithProjectRoot(request: RunDiscoveryRequest): Promise<DiscoveredRunFiles> {
        const realCwd = await readRealCwd(request.cwd, dependencies);
        const files = request.paths.length === 0
            ? await discoverProfileOnlyRunFiles(realCwd, request.profileFiles, dependencies)
            : await discoverRequestedRunFiles(realCwd, request, dependencies);

        return {
            files,
            projectRoot: realCwd
        };
    }

    async function discoverRunFiles(
        request: RunDiscoveryRequest
    ): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
        const discovered = await discoverRunFilesWithProjectRoot(request);

        return discovered.files;
    }

    return {
        discoverRunFiles,
        discoverRunFilesWithProjectRoot
    };
}
