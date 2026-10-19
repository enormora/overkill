import { workIdentityKey, type PerTestResult, type RunExecutionReply } from '../run/run.entry-point.ts';
import {
    canonicalWork,
    hasRunnableMutationSelection,
    mutationLifecycleDataSchema,
    sameMutationCatalog,
    type CampaignBaseline,
    type MutationCatalog
} from './mutation-catalog.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;
type LifecycleData = ReturnType<typeof mutationLifecycleDataSchema.parse>;

export type MutationInvocationExpectation = {
    readonly kind: 'dry';
    readonly baseline: CampaignBaseline | null;
    readonly testFiles: readonly string[] | null;
} | {
    readonly kind: 'mutant';
    readonly baseline: CampaignBaseline;
    readonly selected: readonly string[];
    readonly disableBail: boolean;
};

function matchesIntentionalSkip(result: PerTestResult, reason: string): boolean {
    return result.verdict === 'skip' && result.outcome?.kind === 'skip' && result.outcome.reason === reason;
}

export function mutationCaseMatchesCatalog(
    root: string,
    result: PerTestResult,
    catalog: ReadonlyMap<string, MutationCatalog[number]>
): boolean {
    const id = workIdentityKey(canonicalWork(root, result.workId));
    const entry = catalog.get(id);
    if (entry === undefined) {
        return false;
    }
    return entry.skipReason === null
        ? result.verdict !== 'skip' && result.outcome?.kind !== 'skip'
        : matchesIntentionalSkip(result, entry.skipReason);
}

function validTestOutcome(root: string, reply: ResultReply, data: LifecycleData): boolean {
    const catalog = new Map(data.catalog.map(function catalogEntry(entry) {
        return [ entry.id, entry ];
    }));
    return reply.result.perTest.every(function (result) {
        return mutationCaseMatchesCatalog(root, result, catalog);
    });
}
function observedIdentities(root: string, reply: ResultReply, data: LifecycleData): boolean {
    const executed = reply.result.perTest.map(function (result) {
        return workIdentityKey(canonicalWork(root, result.workId));
    });
    const identities = new Set(executed);
    const selected = new Set(data.selected);
    return identities.size === executed.length && executed.length === data.completed.length &&
        executed.every(function (id, index) {
            return id === data.completed[index] && selected.has(id);
        });
}
function validCoverageOwners(data: LifecycleData): boolean {
    const completed = new Set(data.completed);
    return Object.keys(data.coverage.perTest).every(function (id) {
        return completed.has(id);
    });
}
function sameSelection(left: readonly string[], right: readonly string[]): boolean {
    const selected = new Set(left);
    const requested = new Set(right);
    return selected.size === left.length && requested.size === right.length &&
        selected.size === requested.size && selected.isSubsetOf(requested);
}

function expectedSelection(data: LifecycleData, expectation: MutationInvocationExpectation): boolean {
    const identities = data.catalog.map(function testIdentity(entry) {
        return entry.id;
    });
    if (expectation.kind === 'dry') {
        return identities.length > 0 && sameSelection(data.selected, identities);
    }
    const eligible = new Set(identities);
    const selected = new Set(data.selected);
    return sameSelection(data.selected, expectation.selected) && selected.isSubsetOf(eligible) &&
        hasRunnableMutationSelection(data.catalog, expectation.selected);
}
function completedSelection(reply: ResultReply, data: LifecycleData, allowBail: boolean): boolean {
    return reply.result.perTest.length === data.selected.length || allowBail && data.bailed;
}
function expectedCatalog(root: string, data: LifecycleData, expectation: MutationInvocationExpectation): boolean {
    const { testFiles } = expectation.kind === 'dry' ? expectation : expectation.baseline;
    const eligible = testFiles === null ? null : new Set(testFiles);
    return (expectation.baseline === null || sameMutationCatalog(data.catalog, expectation.baseline.catalog)) &&
        data.catalog.every(function canonicalEligibleCase(entry) {
            return entry.id === workIdentityKey(canonicalWork(root, entry.work)) &&
                (eligible === null || entry.work.case.file !== null && eligible.has(entry.work.case.file));
        });
}

function validFailureEvidence(data: LifecycleData): boolean {
    const selected = new Set(data.selected);
    const completed = new Set(data.completed);
    const runnable = new Set(
        data
            .catalog
            .filter(function runnableCase(entry) {
                return entry.skipReason === null;
            })
            .map(function caseIdentity(entry) {
                return entry.id;
            })
    );
    const failures = new Set(data.caseFailures.map(function failedIdentity(failure) {
        return failure.id;
    }));
    const ordered = data.completed.filter(function failedCompletion(id) {
        return failures.has(id);
    });
    return completed.size === data.completed.length && completed.isSubsetOf(selected) &&
        failures.size === data.caseFailures.length && failures.isSubsetOf(completed) && failures.isSubsetOf(runnable) &&
        data.caseFailures.every(function orderedFailure(failure, index) {
            return failure.id === ordered[index];
        });
}

export function mutationSnapshotError(
    root: string,
    data: LifecycleData,
    expectation: MutationInvocationExpectation
): string | null {
    const checks: readonly (readonly [boolean, string])[] = [
        [ expectedCatalog(root, data, expectation), 'Eligible test catalog changed under mutation.' ],
        [ expectedSelection(data, expectation), 'Execution changed the requested test selection.' ],
        [ validFailureEvidence(data), 'Execution returned invalid case failure evidence.' ]
    ];
    return checks
        .find(function invalidEvidence([ valid ]) {
            return !valid;
        })
        ?.[1] ?? null;
}

export function mutationObservationError(
    root: string,
    reply: ResultReply,
    expectation: MutationInvocationExpectation
): string | null {
    const data = mutationLifecycleDataSchema.parse(reply.data);
    const allowBail = expectation.kind === 'mutant' && !expectation.disableBail;
    const checks: readonly (readonly [boolean, string])[] = [
        [ expectedCatalog(root, data, expectation), 'Eligible test catalog changed under mutation.' ],
        [ expectedSelection(data, expectation), 'Execution changed the requested test selection.' ],
        [ reply.result.summary.planned === data.selected.length, 'Execution changed the planned test count.' ],
        [ !data.bailed || allowBail, 'Execution stopped despite disabled bail.' ],
        [ validTestOutcome(root, reply, data), 'Mutant execution changed intentional skip state or test identity.' ],
        [ observedIdentities(root, reply, data), 'Execution did not deliver complete case lifecycle observations.' ],
        [ validCoverageOwners(data), 'Instrumentation coverage contains an unknown or incomplete test identity.' ],
        [ completedSelection(reply, data, allowBail), 'Execution did not complete the selected test catalog.' ],
        [ validFailureEvidence(data), 'Execution returned invalid case failure evidence.' ]
    ];
    return checks
        .find(function failedObservation([ valid ]) {
            return !valid;
        })
        ?.[1] ?? null;
}
