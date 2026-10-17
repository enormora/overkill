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
    const completed = new Set(data.completed);
    return Object.keys(data.coverage.perTest).every(function (id) {
        return completed.has(id);
    });
}
function completeDryCatalog(data: LifecycleData): boolean {
    const identities = new Set(data.catalog.map(function testIdentity(entry) {
        return entry.id;
    }));
    const selected = new Set(data.selected);
    return identities.size > 0 && identities.size === data.catalog.length &&
        selected.size === data.selected.length && selected.size === identities.size && !data.bailed &&
        data.selected.every(function eligibleTest(id) {
            return identities.has(id);
        });
}
function completedSelection(reply: ResultReply, data: LifecycleData, allowBail: boolean): boolean {
    return reply.result.perTest.length === data.selected.length || allowBail && data.bailed;
}
export function mutationObservationError(root: string, reply: ResultReply, allowBail: boolean): string | null {
    const data = mutationLifecycleDataSchema.parse(reply.data);
    const checks: readonly (readonly [boolean, string])[] = [
        [ allowBail || completeDryCatalog(data), 'Dry run did not select the complete eligible test catalog.' ],
        [ validTestOutcome(root, reply, data), 'Mutant execution changed intentional skip state or test identity.' ],
        [ observedIdentities(root, reply, data), 'Execution did not deliver complete case lifecycle observations.' ],
        [ validCoverageOwners(data), 'Instrumentation coverage contains an unknown or incomplete test identity.' ],
        [ completedSelection(reply, data, allowBail), 'Execution did not complete the selected test catalog.' ]
    ];
    return checks
        .find(function failedObservation([ valid ]) {
            return !valid;
        })
        ?.[1] ?? null;
}
