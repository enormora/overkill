import type { JsonValue, ReadonlyDeep } from 'type-fest';
import type { CaseId, WorkId } from '../engine/identity.ts';

export type BaselineJson = ReadonlyDeep<JsonValue>;
export type BaselineSubtype = 'content-snapshot' | 'performance-baseline' | 'terminal-snapshot' | 'visual-snapshot';
export type BaselineUpdateMode = 'apply' | 'bootstrap' | 'diff' | 'none' | 'update';
export type BaselineIdentity = {
    readonly adapter: string;
    readonly profile: string;
    readonly subtype: BaselineSubtype;
    readonly work: WorkId;
    readonly comparisonContext: Readonly<Record<string, string>>;
};
export type BaselineEntry<TBaseline> = { readonly baseline: TBaseline; readonly path: string; };
type CreatedBaseline<T> = { readonly baseline: T; readonly kind: 'create'; };
type RemovedBaseline<T> = { readonly baseline: T; readonly kind: 'remove'; };
type UpdatedBaseline<T> = { readonly baseline: T; readonly kind: 'update'; readonly previous: T; };
export type BaselineChange<T> = CreatedBaseline<T> | RemovedBaseline<T> | UpdatedBaseline<T>;
type BlockedWrites = { readonly kind: 'blocked'; };
type ReadOnlyWrites = { readonly kind: 'read-only'; };
type FailedWrites<T> = { readonly kind: 'failed'; readonly writtenChanges: readonly BaselineChange<T>[]; };
type WrittenChanges<T> = { readonly kind: 'written'; readonly changes: readonly BaselineChange<T>[]; };
export type BaselineWriteOutcome<T> = BlockedWrites | FailedWrites<T> | ReadOnlyWrites | WrittenChanges<T>;
type MissingObservation = { readonly kind: 'missing'; readonly reason: string; };
type InapplicableObservation = { readonly kind: 'not-applicable'; };
type ObservedValue<T> = { readonly kind: 'observed'; readonly value: T; };
export type BaselineObservation<T> = InapplicableObservation | MissingObservation | ObservedValue<T>;
type MatchingBaseline = { readonly kind: 'match'; };
type MismatchingBaseline<T> = { readonly kind: 'mismatch'; readonly diagnostics: readonly [T, ...(readonly T[])]; };
export type BaselineComparison<T> = MatchingBaseline | MismatchingBaseline<T>;
type ProposalInput<T> = { readonly actual: T; readonly expected: T | null; };
type ComparisonInput<T> = { readonly actual: T; readonly expected: T; };
export type BaselineAdapter<TInput, TObserved, TValue, TProposal, TDiagnostic> = {
    readonly id: string;
    readonly observe: (input: TInput) => BaselineObservation<TObserved> | Promise<BaselineObservation<TObserved>>;
    readonly propose: (input: ProposalInput<TValue>) => Promise<TProposal> | TProposal;
    readonly compare: (
        input: ComparisonInput<TValue>
    ) => BaselineComparison<TDiagnostic> | Promise<BaselineComparison<TDiagnostic>>;
};
type IncompleteInventory = { readonly kind: 'incomplete'; };
type CompleteInventory = {
    readonly kind: 'complete';
    readonly participating: readonly BaselineIdentity[];
    readonly preservedCases: readonly CaseId[];
};
export type BaselineInventory = CompleteInventory | IncompleteInventory;
