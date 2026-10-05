import type { RunResult } from '../engine/run-result.ts';
import type { CoverageRunnerErrorCause } from '../engine/coverage-artifact.ts';
import type { CoverageSession, CoverageSessionRequest } from './coverage-session.ts';
import { RunCollectionError } from './run-errors.ts';
import type { RunCoveragePolicy, RunProfileConfig } from './run-types.ts';

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
    const cause: CoverageRunnerErrorCause = {
        error,
        kind: 'coverage-operation',
        phase: 'setup'
    };

    return new RunCollectionError(
        error instanceof Error ? `Coverage setup failed: ${error.message}` : 'Coverage setup failed.',
        { cause },
        'coverage'
    );
}

export async function startCoverageSession(request: CoverageSessionRequest): Promise<CoverageSession> {
    let session: CoverageSession | null = null;

    try {
        session = await loadCoverageSession(request);
        await session.start();

        return session;
    } catch (error: unknown) {
        if (session !== null) {
            await ignoreCoverageDisposalFailure(session);
        }

        throw coverageSetupError(error);
    }
}

export function microtestCoveragePolicy(profile: RunProfileConfig): RunCoveragePolicy {
    if (profile.testFamily !== 'microtest') {
        throw new Error('Coverage policy requires a microtest profile.');
    }

    return profile.coverage;
}

export function coverageExecutionCompleted(result: RunResult): boolean {
    return result.summary.crashed === 0 && result.summary.resourceExhausted === 0 &&
        result.runnerErrors.every(function coverageWasNotInterrupted(error) {
            return !interruptedCoverageErrorSubtypes.has(error.subtype);
        });
}
