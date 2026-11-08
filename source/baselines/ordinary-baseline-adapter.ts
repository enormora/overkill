import type { RunArtifact } from '../engine/run-result.ts';
import type { WorkId } from '../engine/identity.ts';
import type { BaselineAdapter, BaselineComparison, BaselineSubtype, BaselineUpdateMode } from './baseline-model.ts';
import type { BaselineDiagnostic } from './performance-adapter.ts';

export type OrdinaryBaselineSubtype = Exclude<BaselineSubtype, 'performance-baseline'>;
export type BaselinePayload = {
    readonly kind: 'binary';
    readonly bytes: Uint8Array;
} | {
    readonly kind: 'text';
    readonly text: string;
};
export type OrdinaryObservationInput = {
    readonly artifacts: readonly RunArtifact[];
    readonly work: WorkId;
};
export type BaselineAdapterDefinition<Observed, Value, Proposal> = {
    readonly subtype: OrdinaryBaselineSubtype;
    readonly comparisonContext: Readonly<Record<string, string>>;
    readonly adapter: BaselineAdapter<OrdinaryObservationInput, Observed, Value, Proposal, BaselineDiagnostic>;
    readonly toComparisonValue: (observed: Observed) => Promise<Value> | Value;
    readonly encode: (proposal: Proposal) => BaselinePayload | Promise<BaselinePayload>;
    readonly decode: (payload: BaselinePayload) => Promise<Value> | Value;
};

export type BaselineEvaluationInput = OrdinaryObservationInput & {
    readonly existing: BaselinePayload | null;
    readonly mode: BaselineUpdateMode;
};
export type OrdinaryBaselineEvaluation = {
    readonly kind: 'missing';
    readonly reason: string;
} | {
    readonly kind: 'not-applicable';
} | {
    readonly kind: 'observed';
    readonly comparison: BaselineComparison<BaselineDiagnostic> | null;
    readonly proposal: BaselinePayload | null;
};
export type OrdinaryBaselineAdapter = {
    readonly id: string;
    readonly subtype: OrdinaryBaselineSubtype;
    readonly comparisonContext: Readonly<Record<string, string>>;
    readonly evaluate: (input: BaselineEvaluationInput) => Promise<OrdinaryBaselineEvaluation>;
};
