import type { CoverageReportingRuntime, CoverageReportBackend } from '../run/coverage-reporting.ts';
import { memoryCoverageAccess } from './coverage-source-memory.ts';

type CoverageBackendResult = NonNullable<Awaited<ReturnType<CoverageReportBackend['generate']>>>;
type CoverageBackendFixture = { readonly runtime: CoverageReportingRuntime; readonly calls: readonly unknown[]; };
export function coverageReportBackend(
    cached: boolean,
    result: Readonly<CoverageBackendResult> | undefined,
    entries: boolean
): CoverageBackendFixture {
    const calls: unknown[] = [];
    const runtime: CoverageReportingRuntime = {
        sources: memoryCoverageAccess(
            { '/project/source/value.js': 'export const value = 42;' },
            entries ? [ { entries: [ { url: 'file:///project/source/value.js' } ], sourceMaps: {} } ] : []
        ),
        createReport(options) {
            calls.push(options);
            return {
                hasCache() {
                    return cached;
                },
                async add(batch) {
                    calls.push({ batch });
                },
                async addFromDir(path) {
                    calls.push({ directory: path });
                },
                async generate() {
                    calls.push('generate');
                    return result;
                }
            };
        }
    };
    return { runtime, calls };
}
