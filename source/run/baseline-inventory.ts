import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { RunResult } from '../engine/run-result.ts';
import { baselineIdentityKey, findStaleBaselines } from '../baselines/baseline-planning.ts';
import type { BaselineIdentity } from '../baselines/baseline-model.ts';
import type { OrdinaryBaselinePolicy } from '../baselines/baseline-policy.ts';
import { baselineRunnerError, successfulBaselineRun } from './baseline-outcomes.ts';
import {
    ordinaryBaselineIdentity,
    type OrdinaryBaselineChange,
    type StoredOrdinaryBaseline
} from './baseline-record.ts';
import type { RunRequest } from './run-types.ts';

export function belongsToBaselineScope(
    policy: OrdinaryBaselinePolicy,
    profile: string,
    baseline: StoredOrdinaryBaseline
): boolean {
    if (baseline.profile.normalize('NFC') !== profile.normalize('NFC')) {
        return false;
    }
    const identity = ordinaryBaselineIdentity(baseline);
    return policy.adapters.some(function configuredScope(adapter) {
        const expected = {
            ...identity,
            adapter: adapter.id,
            subtype: adapter.subtype,
            comparisonContext: adapter.comparisonContext
        };
        return baselineIdentityKey(expected) === baselineIdentityKey(identity);
    });
}
function completeInventory(request: RunRequest): boolean {
    const unfiltered = request.paths.length === 0 && request.selection.kind === 'all';
    return unfiltered && request.shard.total === 1 && !request.lastFailed;
}
type InventoryInput = {
    readonly policy: OrdinaryBaselinePolicy;
    readonly request: RunRequest;
    readonly result: RunResult;
    readonly existing: readonly StoredOrdinaryBaseline[];
    readonly participating: readonly BaselineIdentity[];
};
type InventoryCompletion = {
    readonly result: RunResult;
    readonly changes: readonly OrdinaryBaselineChange[];
    readonly warnings: readonly string[];
};
function reportStaleInventory(input: InventoryInput, stale: readonly StoredOrdinaryBaseline[]): InventoryCompletion {
    if (input.request.baselineUpdateMode === 'apply' || input.request.baselineUpdateMode === 'diff') {
        const changes = stale.map(function removal(baseline): OrdinaryBaselineChange {
            return { kind: 'remove', baseline };
        });
        return { result: input.result, changes, warnings: [] };
    }
    const message = `Found ${stale.length.toString()} stale baselines. Use "overkill baseline apply".`;
    if (input.request.baselineUpdateMode !== 'none' || input.policy.stale === 'warn') {
        return { result: input.result, changes: [], warnings: [ message ] };
    }
    return {
        result: appendRunnerErrors(input.result, [ baselineRunnerError(new Error(message), null) ]),
        changes: [],
        warnings: []
    };
}
export function reconcileBaselineInventory(input: InventoryInput): InventoryCompletion {
    if (!completeInventory(input.request) || !successfulBaselineRun(input.result)) {
        return { result: input.result, changes: [], warnings: [] };
    }
    const preservedCases = input
        .result
        .perTest
        .filter(function skipped(entry) {
            return entry.verdict === 'skip';
        })
        .map(function identity(entry) {
            return entry.id;
        });
    const stale = findStaleBaselines(input.existing, {
        kind: 'complete',
        participating: input.participating,
        preservedCases
    }, ordinaryBaselineIdentity);
    return stale.length === 0
        ? { result: input.result, changes: [], warnings: [] }
        : reportStaleInventory(input, stale);
}
