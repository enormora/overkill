import type { RunnerError } from '../engine/run-result.ts';
import { RunCollectionError } from './run-errors.ts';

export type RunRecordPhase = 'checkpoint' | 'complete' | 'facts' | 'interrupt' | 'start';

export class RunRecordError extends RunCollectionError {
    private readonly recordPath: string;
    private readonly recordPhase: RunRecordPhase;

    public constructor(filePath: string, options: Readonly<ErrorOptions>, phase: RunRecordPhase) {
        super(`Failed to persist run record during ${phase}: ${filePath}.`, options, 'runtime-state');
        this.name = 'RunRecordError';
        this.recordPath = filePath;
        this.recordPhase = phase;
    }

    public override runnerError(): RunnerError {
        return {
            ...super.runnerError(),
            diagnostics: [
                { label: 'Run record phase', value: this.recordPhase },
                { label: 'Run record path', value: this.recordPath }
            ]
        };
    }
}

export function runRecordPersistenceError(filePath: string, phase: RunRecordPhase, error: unknown): RunRecordError {
    return new RunRecordError(filePath, {
        cause: { error, kind: 'run-record-persistence', path: filePath, phase }
    }, phase);
}
