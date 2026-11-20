import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { observationPlan } from '../test-support/observation-lifetime.ts';
import { createCollectedPlan, workerPoolResolvedRun } from '../test-support/worker-pool-execution-state.ts';
import { runCollectionRootFromResolvedPlan, emptyRunPlanStatus } from './collected-run-plan.ts';

export const testNode = authoredSuite('collection root and empty selection transport', [
    authoredTest('preserves explicitly authored root controls in local collection', function (scope: TestScope) {
        const original = observationPlan();
        const controls = { capture: 'buffered', duplicateExecution: 'idempotent', timeoutMilliseconds: 42 } as const;
        const testPlan = { ...original, root: { ...original.root, controls } };
        scope.assert.deepEqual(runCollectionRootFromResolvedPlan({ kind: 'local', testPlan }), {
            title: original.root.title,
            annotations: original.root.annotations,
            controls
        });
        return scope.assert.collect();
    }),
    ...[ false, true ].map(function (lastFailed) {
        return authoredTest(`classifies absent selection with last-failed ${lastFailed}`, function (scope: TestScope) {
            const original = createCollectedPlan();
            const plan = { ...original, discoveredFiles: original.files };
            const run = workerPoolResolvedRun(plan);
            const empty = { ...run, request: { ...run.request, lastFailed, selection: { kind: 'none' as const } } };
            scope.assert.equal(emptyRunPlanStatus(empty, plan), lastFailed ? 'empty-selection' : 'empty-shard');
            scope.assert.equal(
                emptyRunPlanStatus({ ...empty, request: { ...empty.request, selection: { kind: 'all' } } }, plan),
                'empty-shard'
            );
            return scope.assert.collect();
        });
    })
]);
