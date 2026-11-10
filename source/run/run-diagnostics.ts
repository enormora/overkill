import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import type { CollectedRunCase, ResolvedRun } from './run-types.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import { resolveDebugSelection } from './run-debug.ts';

type LocalCase = Extract<ResolvedRun['plan'], { readonly kind: 'local'; }>['testPlan']['cases'][number];

function isLocalCase(testCase: CollectedRunCase | LocalCase): testCase is LocalCase {
    return Object.hasOwn(testCase, 'execution');
}

function benchmarkAttachments(definition: CollectedRunCase['benchmark']): boolean {
    return definition !== null && (
        definition.measurement.mode === 'process' || definition.measurement.mode === 'module' ||
        definition.timeline !== null
    );
}

function hasBenchmarkAttachments(testCase: CollectedRunCase | LocalCase): boolean {
    if (isLocalCase(testCase)) {
        const { execution } = testCase;
        return execution.kind === 'body' && execution.bodyMode === 'benchmark' &&
            benchmarkAttachments(execution.definition);
    }
    return benchmarkAttachments(testCase.benchmark);
}

function runSupportsAttachments(resolved: ResolvedRun): boolean {
    const family = resolved.facts.execution.testFamily;
    return family !== 'microtest' && family !== 'property' && resolved.facts.cases.length > 0;
}

function snapshotsEnabled(resolved: ResolvedRun): boolean {
    const profile = resolved.config.profiles[resolved.request.profile];
    return profile?.testFamily === 'integration' && profile.baselines.snapshots;
}

export function runHasAttachmentScopes(resolved: ResolvedRun): boolean {
    if (!runSupportsAttachments(resolved)) {
        return false;
    }
    if (snapshotsEnabled(resolved)) {
        return true;
    }
    const selected = new Set(resolved.facts.cases.map(function selectedWork(entry) {
        return workIdentityKey(entry.workId);
    }));
    const cases = resolved.plan.kind === 'local'
        ? resolved.plan.testPlan.cases.map(function localCase(testCase) {
            return { testCase, workId: testCase.workId };
        })
        : collectedRunCaseEntries(resolved.plan.collectedPlan);
    return cases.some(function hasAttachmentScope(entry) {
        return selected.has(workIdentityKey(entry.workId)) &&
            (hasBenchmarkAttachments(entry.testCase) || entry.testCase.resourceAttachments.resourceGraph.length > 0 ||
                entry.testCase.resourceAttachments.runtimeGraphs.length > 0);
    });
}

type DiagnosticCase = Pick<LocalCase, 'annotations' | 'id' | 'workId'>;
function diagnosticCases(input: ResolvedRun): readonly DiagnosticCase[] {
    if (input.plan.kind === 'local') {
        return input.plan.testPlan.cases;
    }
    return collectedRunCaseEntries(input.plan.collectedPlan).map(function candidate(entry) {
        return { id: entry.id, workId: entry.workId, annotations: entry.testCase.annotations };
    });
}
export function debuggedWork(input: ResolvedRun): readonly WorkId[] {
    if (input.request.debug.mode === 'off') {
        return [];
    }
    const cases = diagnosticCases(input);
    const selection = resolveDebugSelection(input.request.debug, cases);
    return selection.mode === 'selected' ? selection.work : cases.map(function identity(testCase) {
        return testCase.workId;
    });
}
