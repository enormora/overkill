import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateCoverageReports } from './coverage-reporting.ts';
import { createCoveragePaths } from './coverage-paths.ts';
import { createCoverageProfiler } from './coverage-profiler.ts';
import { createCoverageCollection, type CoverageSession, type CoverageSessionRequest } from './coverage-collection.ts';

export async function createCoverageSession(request: CoverageSessionRequest): Promise<CoverageSession> {
    return await createCoverageCollection(request, {
        environment: Reflect.get(process, 'env'),
        createPaths: createCoveragePaths,
        createProfiler: createCoverageProfiler,
        report: generateCoverageReports,
        async write(paths, coverage) {
            await writeFile(
                path.join(paths.rawDataDirectory, `coverage-${process.pid}-in-process.json`),
                JSON.stringify({ result: coverage.result, timestamp: Date.now() }),
                'utf8'
            );
        }
    });
}
