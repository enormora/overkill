import { workIdentityKey } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { BenchmarkDefinitionSummary } from '../engine/benchmark-result.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import type { ResolvedRun, CollectedRunCase } from './run-types.ts';

function isLocalCase(testCase: CollectedRunCase | TestPlanCase): testCase is TestPlanCase {
    return Object.hasOwn(testCase, 'execution');
}

function benchmarkAttachments(definition: BenchmarkDefinitionSummary | null): boolean {
    return definition !== null && (
        definition.measurement.mode === 'process' ||
        definition.timeline !== null
    );
}

function hasBenchmarkAttachments(testCase: CollectedRunCase | TestPlanCase): boolean {
    if (isLocalCase(testCase)) {
        const { execution } = testCase;
        return execution.kind === 'body' && execution.bodyMode === 'benchmark' &&
            benchmarkAttachments(execution.definition);
    }
    return benchmarkAttachments(testCase.benchmark);
}

export function runHasAttachmentScopes(resolved: ResolvedRun): boolean {
    if (
        resolved.facts.execution.testFamily === 'microtest' || resolved.facts.execution.testFamily === 'property' ||
        resolved.facts.cases.length === 0
    ) {
        return false;
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
