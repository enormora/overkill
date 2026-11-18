import { collectedRunCaseEntries } from '../run/collected-run-plan.ts';
import { collectedRunCaseFactsFromEntries, runCaseFactsFromTestPlan } from '../run/run-case-facts.ts';
import type { ResolvedRun, CollectedRunCase, RunDebugRequest } from '../run/run-types.ts';
import { workerPoolResolvedRun, createCollectedPlan } from './worker-pool-execution-state.ts';
import { observationPlan } from './observation-lifetime.ts';
import { definition } from './benchmark-placement-fixture.ts';

type AttachmentShape = 'module' | 'plain' | 'process';
function benchmarkForShape(shape: AttachmentShape): CollectedRunCase['benchmark'] {
    if (shape === 'process') {
        return { ...definition(), measurement: { mode: 'process', instrumentation: 'off' } };
    }
    return shape === 'module' ? { ...definition(), measurement: { mode: 'module' } } : null;
}
function noFileSet(): null {
    return null;
}
export function diagnosticRun(shape: AttachmentShape, local: boolean, debug: RunDebugRequest): ResolvedRun {
    const original = createCollectedPlan();
    const files = original.files.map(function (file) {
        return {
            ...file,
            cases: file.cases.map(function (testCase) {
                return { ...testCase, benchmark: benchmarkForShape(shape) };
            })
        };
    });
    const collection = { ...original, files };
    const run = workerPoolResolvedRun(collection);
    const plan = observationPlan();
    return {
        ...run,
        request: { ...run.request, debug },
        plan: local ? { kind: 'local', testPlan: plan } : run.plan,
        facts: {
            ...run.facts,
            cases: local
                ? runCaseFactsFromTestPlan(plan, noFileSet)
                : collectedRunCaseFactsFromEntries(collectedRunCaseEntries(collection), noFileSet)
        }
    };
}
