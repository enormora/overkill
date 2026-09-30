import type { RunResult } from '../engine/run-result.ts';
import type { CoverageSession, CoverageSessionRequest } from './coverage-session.ts';
import { RunCollectionError } from './run-errors.ts';

const interruptedCoverageErrorSubtypes = new Set<string>([ 'crash', 'loader', 'resource-exhaustion' ]);

async function loadCoverageSession(request: CoverageSessionRequest): Promise<CoverageSession> {
    const coverage = await import('./coverage-session.ts');

    return await coverage.createCoverageSession(request);
}

async function ignoreCoverageDisposalFailure(session: CoverageSession): Promise<void> {
    try {
        await session.dispose();
    } catch {
        return undefined;
    }

    return undefined;
}

function coverageSetupError(error: unknown): RunCollectionError {
    return new RunCollectionError(
        error instanceof Error ? `Coverage setup failed: ${error.message}` : 'Coverage setup failed.',
        { cause: error },
        'runtime-state'
    );
}

export async function startCoverageSession(request: CoverageSessionRequest): Promise<CoverageSession> {
    const session = await loadCoverageSession(request);

    try {
        await session.start();

        return session;
    } catch (error: unknown) {
        await ignoreCoverageDisposalFailure(session);

        throw coverageSetupError(error);
    }
}

export function coverageExecutionCompleted(result: RunResult): boolean {
    return result.summary.crashed === 0 && result.summary.resourceExhausted === 0 &&
        result.runnerErrors.every(function coverageWasNotInterrupted(error) {
            return !interruptedCoverageErrorSubtypes.has(error.subtype);
        });
}
