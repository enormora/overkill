import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { invalidRequest, noTestsCollected } from './run-errors.ts';

export type RunDiscoveryRequest = {
    readonly cwd: string;
    readonly paths: readonly string[];
};

export type DiscoveredRunFile = {
    readonly file: string;
    readonly href: string;
    readonly path: string;
};

function toFileIdentity(path: string): string {
    return path.replaceAll('\\', '/');
}

function isOutsideCwd(relativePath: string): boolean {
    return relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath);
}

async function readRealCwd(cwd: string): Promise<string> {
    try {
        return await realpath(cwd);
    } catch {
        return invalidRequest(`Run cwd does not exist: ${cwd}`);
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

async function assertRealFile(realPath: string, requestedPath: string): Promise<void> {
    const fileStat = await stat(realPath);

    if (!fileStat.isFile()) {
        invalidRequest(`Run path must be a file: ${requestedPath}`);
    }
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

function assertNonEmptyDiscoveredFiles(
    files: readonly DiscoveredRunFile[]
): asserts files is NonEmptyReadonlyArray<DiscoveredRunFile> {
    if (files.length === 0) {
        noTestsCollected('No explicit run paths were provided.');
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

export async function discoverRunFiles(
    request: RunDiscoveryRequest
): Promise<NonEmptyReadonlyArray<DiscoveredRunFile>> {
    const realCwd = await readRealCwd(request.cwd);
    const files = await Promise.all(request.paths.map(async function discoverPath(requestedPath) {
        return await discoverRunFile(realCwd, requestedPath);
    }));
    const seenPaths = new Set<string>();

    for (const file of files) {
        assertUniqueRunFile(file, seenPaths);
        seenPaths.add(file.path);
    }

    assertNonEmptyDiscoveredFiles(files);

    return files;
}
