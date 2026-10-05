import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './path-containment.ts';
import type { RunCoveragePolicy } from './run-types.ts';

export type CoveragePaths = {
    readonly coverageDirectory: string;
    readonly projectRoot: string;
    readonly rawDataDirectory: string;
};

export type CoveragePathRequest = {
    readonly coverage: RunCoveragePolicy;
    readonly projectRoot: string;
    readonly runtimeStateDir: string;
    readonly runId: string;
};

async function nearestExistingPath(candidate: string): Promise<string> {
    try {
        return await realpath(candidate);
    } catch (error: unknown) {
        const parentPath = path.dirname(candidate);

        if (parentPath === candidate) {
            throw error;
        }

        return await nearestExistingPath(parentPath);
    }
}

async function validateCreatedCoverageDirectory(projectRoot: string, coverageDirectory: string): Promise<void> {
    if (!isPathInside(projectRoot, await realpath(coverageDirectory))) {
        throw new Error('Coverage output directory resolves outside the project root.');
    }
}

async function assertCoveragePathInsideProject(projectRoot: string, coverageDirectory: string): Promise<void> {
    const existingAncestor = await nearestExistingPath(coverageDirectory);

    if (
        [ coverageDirectory, existingAncestor ].some(function escapesProject(candidate) {
            return !isPathInside(projectRoot, candidate);
        })
    ) {
        throw new Error('Coverage output directory must remain inside the project root.');
    }
}

export function resolveCoveragePaths(request: CoveragePathRequest): CoveragePaths {
    const projectRoot = path.resolve(request.projectRoot);
    const runtimeStateRoot = path.resolve(projectRoot, request.runtimeStateDir);
    const coverageDirectory = request.coverage.outputDirectory ??
        path.join(runtimeStateRoot, 'runs', request.runId, 'coverage');
    const rawDataDirectory = request.coverage.outputDirectory === null
        ? path.join(coverageDirectory, 'raw')
        : path.join(coverageDirectory, 'raw', request.runId);

    return { coverageDirectory, projectRoot, rawDataDirectory };
}

export async function createCoveragePaths(paths: CoveragePaths): Promise<CoveragePaths> {
    const projectRoot = await realpath(paths.projectRoot);

    await assertCoveragePathInsideProject(projectRoot, paths.coverageDirectory);
    await mkdir(paths.rawDataDirectory, { recursive: true });
    await validateCreatedCoverageDirectory(projectRoot, paths.coverageDirectory);

    return { ...paths, projectRoot };
}
