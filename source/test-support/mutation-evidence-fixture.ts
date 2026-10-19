import type { TestScope } from '../packages/test/test.entry-point.ts';
import type { PerTestResult, RunExecutionLifecycle, RunnerError } from '../packages/run/run.entry-point.ts';
import { createMutationLifecycle } from '../packages/stryker-runner/mutation-lifecycle.ts';
import type { MutationInvocationExpectation } from '../packages/stryker-runner/mutation-observation.ts';
import { mutationCoverageFixture } from './mutation-coverage-fixture.ts';
import { collectedMutationPlan } from './mutation-plan-fixture.ts';

type MutationEvidenceFixture = {
    readonly lifecycle: RunExecutionLifecycle;
    readonly first: PerTestResult;
    readonly failed: PerTestResult;
    readonly cleanupFailed: PerTestResult;
    readonly passing: readonly PerTestResult[];
    readonly expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>;
    readonly record: (result: PerTestResult, errors: readonly RunnerError[]) => Promise<void>;
};

function failedCase(result: PerTestResult, kind: 'body-error' | 'cleanup-error'): PerTestResult {
    const outcome = {
        kind: 'fail',
        failures: [ {
            kind,
            error: { name: 'Error', message: `${kind} sentinel`, stack: null, thrown: null }
        } ]
    } as const;
    return {
        ...result,
        outcome,
        verdict: outcome.kind,
        attempts: [ { ...result.attempts[0], outcome, verdict: outcome.kind } ]
    };
}

export async function createMutationEvidenceFixture(scope: TestScope): Promise<MutationEvidenceFixture> {
    const { baseline, reply } = mutationCoverageFixture('off');
    const first = reply.result.perTest[0];
    if (first === undefined) {
        throw new Error('Missing case fixture.');
    }
    const selected = baseline.catalog.map(function identity(entry) {
        return entry.id;
    });
    const lifecycle = await createMutationLifecycle({
        root: '/project',
        mode: 'runtime',
        activeMutant: null,
        hitLimit: null,
        baseline: baseline.catalog,
        selected,
        disableBail: true,
        files: null
    });
    scope.cleanup(lifecycle.dispose);
    await lifecycle.select(collectedMutationPlan(reply.result.perTest.map(function work(result) {
        return result.workId;
    })));
    return {
        lifecycle,
        first,
        failed: failedCase(first, 'body-error'),
        cleanupFailed: failedCase(first, 'cleanup-error'),
        passing: reply.result.perTest,
        expectation: { kind: 'mutant', baseline, selected, disableBail: true },
        async record(result, errors) {
            await lifecycle.enterCase(result.workId);
            await lifecycle.completeCase(result, errors);
        }
    };
}
