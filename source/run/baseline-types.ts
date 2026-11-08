import type { Except } from 'type-fest';
import type { BaselineWriteOutcome } from '../baselines/baseline-model.ts';
import type { RunInvocationTimingOptions } from './run-timing-collection.ts';
import type { OrdinaryBaselineChange, OrdinaryBaselineEntry, StoredOrdinaryBaseline } from './baseline-record.ts';
import type { RunCommand, RunReporterDeliveryResult, RunInvocationOptions } from './run-types.ts';

export type BaselineCommand = Except<RunCommand, 'request'> & {
    readonly request: Except<RunCommand['request'], 'baselineUpdateMode'>;
};
export type BaselineListCommand = Pick<RunCommand, 'config' | 'cwd'> & {
    readonly request: { readonly paths: readonly string[]; readonly profile: string; };
};
export type BaselineRunResult = RunReporterDeliveryResult & {
    readonly changes: readonly OrdinaryBaselineChange[];
    readonly warnings: readonly string[];
    readonly writeOutcome: BaselineWriteOutcome<StoredOrdinaryBaseline>;
};
type BaselineVerb = (
    command: BaselineCommand,
    options: RunInvocationOptions | RunInvocationTimingOptions
) => Promise<BaselineRunResult>;
export type BaselineOrchestrator = {
    readonly apply: BaselineVerb;
    readonly bootstrap: BaselineVerb;
    readonly diff: BaselineVerb;
    readonly list: (command: BaselineListCommand) => Promise<readonly OrdinaryBaselineEntry[]>;
    readonly update: BaselineVerb;
};
