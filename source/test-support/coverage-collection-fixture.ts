import type { Profiler } from 'node:inspector';
import type { CoverageCollectionRuntime, CoverageSessionRequest } from '../run/coverage-collection.ts';
import type { CoverageReportRequest, CoverageReportResult } from '../run/coverage-reporting.ts';
import type { CoverageProfiler } from '../run/coverage-profiler.ts';
import { defaultMicrotestProfile } from './run-command-factory.ts';

const paths = {
    projectRoot: '/project',
    coverageDirectory: '/project/coverage',
    rawDataDirectory: '/project/coverage/raw'
};
export const coverageCollectionRequest: CoverageSessionRequest = {
    coverage: defaultMicrotestProfile({}).coverage,
    paths,
    processModel: 'in-process',
    testFiles: [ '/project/case.test.ts' ],
    timing: null
};
export const coverageCollectionReport: CoverageReportResult = {
    reports: [ { format: 'lcov', path: '/project/coverage/lcov.info' } ],
    summary: {
        branches: { covered: 3, total: 4 },
        functions: { covered: 1, total: 2 },
        lines: { covered: 2, total: 3 }
    }
};
type CoverageCollectionFixture = {
    readonly runtime: CoverageCollectionRuntime;
    readonly commands: readonly string[];
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly reports: readonly CoverageReportRequest[];
    readonly writes: readonly Profiler.TakePreciseCoverageReturnType[];
};
function fixtureProfiler(command: (name: string) => void): CoverageProfiler {
    return {
        connect() {
            command('connect');
        },
        disconnect() {
            command('disconnect');
        },
        async enable() {
            command('enable');
        },
        async disable() {
            command('disable');
        },
        async start() {
            command('start');
        },
        async stop() {
            command('stop');
        },
        async take() {
            command('take');
            return { result: [], timestamp: 1 };
        }
    };
}
export function coverageCollectionFixture(
    failures: readonly string[],
    previousDirectory: string | undefined
): CoverageCollectionFixture {
    const commands: string[] = [];
    const reports: CoverageReportRequest[] = [];
    const writes: Profiler.TakePreciseCoverageReturnType[] = [];
    const environment: Record<string, string | undefined> = previousDirectory === undefined
        ? {}
        : { NODE_V8_COVERAGE: previousDirectory };
    function command(name: string): void {
        commands.push(name);
        if (failures.includes(name)) {
            throw new Error(`${name} failed`);
        }
    }
    return {
        commands,
        reports,
        writes,
        environment,
        runtime: {
            environment,
            createProfiler() {
                return fixtureProfiler(command);
            },
            async createPaths(requested) {
                command('paths');
                return requested;
            },
            async report(request) {
                command('report');
                reports.push(request);
                return coverageCollectionReport;
            },
            async write(_paths, coverage) {
                command('write');
                writes.push(coverage);
            }
        }
    };
}
