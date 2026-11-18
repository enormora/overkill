import { testDouble } from '../packages/test/test.entry-point.ts';
import type { CoverageSession, CoverageSessionRequest } from '../run/coverage-collection.ts';

type CoverageStartupFixture = {
    readonly calls: readonly string[];
    readonly session: CoverageSession;
    readonly load: (request: CoverageSessionRequest) => Promise<CoverageSession>;
    readonly requests: readonly CoverageSessionRequest[];
};
export function coverageStartup(
    loadFailure: unknown,
    startFailure: unknown,
    disposeFailure: Error | null
): CoverageStartupFixture {
    const calls: string[] = [];
    const requests: CoverageSessionRequest[] = [];
    const session: CoverageSession = {
        childProcess: null,
        async start() {
            calls.push('start');
            if (startFailure !== null) {
                testDouble.throws<() => void>(startFailure)();
            }
        },
        async dispose() {
            calls.push('dispose');
            if (disposeFailure !== null) {
                throw disposeFailure;
            }
        },
        async finalize(result) {
            return result;
        }
    };
    return {
        calls,
        session,
        requests,
        async load(request) {
            calls.push('load');
            requests.push(request);
            if (loadFailure !== null) {
                testDouble.throws<() => void>(loadFailure)();
            }
            return session;
        }
    };
}
