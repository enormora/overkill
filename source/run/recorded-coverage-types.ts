import type { RunResult } from '../engine/run-result.ts';
import type { CoverageSession } from './coverage-session.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunRecordSession } from './run-record.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import type { RunCommand } from './run-types.ts';

export type RecordedCoverageExecution = {
    readonly record: RunRecordSession;
    readonly session: Pick<CoverageSession, 'childProcess' | 'dispose'> & {
        readonly finalize: (result: RunResult) => Promise<RunResult>;
    };
};
export type RecordedCoverageRequest = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly execute: (execution: RecordedCoverageExecution) => Promise<RunResult>;
    readonly input: ResolvedRunInput;
    readonly timing: RunTimingMeasurement | null;
};
