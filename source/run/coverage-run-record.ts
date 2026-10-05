import path from 'node:path';
import { ulid } from 'ulid';
import { resolveCoveragePaths } from './coverage-paths.ts';
import type { CoverageSessionRequest } from './coverage-session.ts';
import { microtestCoveragePolicy } from './run-coverage.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { createRunRecordSession, type RunRecordSession } from './run-record.ts';
import { runRecordVersions } from './run-record-versions.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';

export type CoverageRunRecord = {
    readonly record: RunRecordSession;
    readonly sessionRequest: CoverageSessionRequest;
    readonly start: () => Promise<void>;
};

function relativePath(projectRoot: string, directory: string): string {
    return path.relative(projectRoot, directory).split(path.sep).join('/');
}

export async function createCoverageRunRecord(
    cwd: string,
    input: ResolvedRunInput,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null
): Promise<CoverageRunRecord> {
    const record = createRunRecordSession(cwd, input, {
        createId: ulid,
        node: dependencies.node,
        store: dependencies.runtimeStateStore,
        versions: await runRecordVersions(input.engine, dependencies.node.version),
        wallClock: dependencies.wallClock
    });
    const coverage = microtestCoveragePolicy(input.profile);
    const paths = resolveCoveragePaths({
        coverage,
        projectRoot: input.projectRoot,
        runId: record.id,
        runtimeStateDir: input.config.runtimeStateDir
    });

    return {
        record,
        sessionRequest: {
            coverage,
            paths,
            processModel: input.profile.execution.processModel === 'in-process' ? 'in-process' : 'supervised-process',
            testFiles: input.files.map(function testFilePath(file) {
                return file.file;
            }),
            timing
        },
        async start() {
            await record.start({
                directory: relativePath(input.projectRoot, paths.coverageDirectory),
                policy: {
                    ...coverage,
                    outputDirectory: coverage.outputDirectory === null
                        ? null
                        : relativePath(input.projectRoot, coverage.outputDirectory)
                },
                rawDataDirectory: relativePath(input.projectRoot, paths.rawDataDirectory)
            });
        }
    };
}
