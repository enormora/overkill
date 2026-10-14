import { workIdentityKey, type RunExecutionReply } from '../run/run.entry-point.ts';
import { canonicalWork, mutationLifecycleDataSchema } from './mutation-catalog.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;
type LifecycleData = ReturnType<typeof mutationLifecycleDataSchema.parse>;

function validTestOutcome(root: string, reply: ResultReply, data: LifecycleData): boolean {
    const catalog = new Map(data.catalog.map(function (entry) {
        return [ entry.id, entry ];
    }));
    return reply.result.perTest.every(function (result) {
        const baseline = catalog.get(workIdentityKey(canonicalWork(root, result.workId)));
        return baseline !== undefined && result.verdict === 'skip' === (baseline.skipReason !== null);
    });
}
function observedIdentities(root: string, reply: ResultReply, data: LifecycleData): boolean {
    const executed = reply.result.perTest.map(function (result) {
        return workIdentityKey(canonicalWork(root, result.workId));
    });
    const identities = new Set(executed);
    return identities.size === executed.length && executed.length === data.completed.length &&
        executed.every(function (id, index) {
            return id === data.completed[index] && data.selected.includes(id);
        });
}
function validCoverageOwners(data: LifecycleData): boolean {
    const eligible = new Set(data.catalog.map(function (entry) {
        return entry.id;
    }));
    return Object.keys(data.coverage.perTest).every(function (id) {
        return eligible.has(id);
    });
}
function completedSelection(reply: ResultReply, data: LifecycleData, allowBail: boolean): boolean {
    return reply.result.perTest.length === data.selected.length || allowBail && data.bailed;
}
export function mutationObservationError(root: string, reply: ResultReply, allowBail: boolean): string | null {
    const data = mutationLifecycleDataSchema.parse(reply.data);
    if (!validTestOutcome(root, reply, data)) {
        return 'Mutant execution changed intentional skip state or test identity.';
    }
    if (!observedIdentities(root, reply, data)) {
        return 'Execution did not deliver complete case lifecycle observations.';
    }
    if (!validCoverageOwners(data)) {
        return 'Instrumentation coverage contains an unknown test identity.';
    }
    if (!completedSelection(reply, data, allowBail)) {
        return 'Execution did not complete the selected test catalog.';
    }
    return null;
}
