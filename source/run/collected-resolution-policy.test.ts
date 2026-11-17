import { runIfMain } from '#test-runner';
import { defaultIntegrationProfile } from '../test-support/run-command-factory.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { passingIsolatedWorkerRun } from '../test-support/isolated-worker-run.ts';
import { createCollectedPlan } from '../test-support/worker-pool-execution-state.ts';
import { createResolvedRunFromCollection, type CollectionResolvedRunInput } from './run-collected-resolution.ts';

function collectionInput(empty: boolean): CollectionResolvedRunInput {
    const fixture = passingIsolatedWorkerRun(false, false);
    const profile = defaultIntegrationProfile({ execution: { processModel: 'supervised-process' } });
    const config = { ...fixture.input.config, profiles: { integration: profile } };
    const source = createCollectedPlan();
    const plan = { ...source, discoveredFiles: source.files, files: empty ? [] : source.files };
    return {
        ...fixture.input,
        profile,
        config,
        allowEmptySelection: empty,
        command: { ...fixture.command, config },
        dependencies: fixture.dependencies,
        durationHistoryIndex: null,
        planKind: 'supervised',
        collection: { collectedPlan: plan, runnerErrors: [] }
    };
}
export const testNode = suite(
    'collected execution resolution policy',
    [ false, true ].map(function (empty) {
        return test(
            `preserves supervised collection facts with empty plan ${empty}`,
            async function (scope: TestScope) {
                const input = collectionInput(empty);
                const run = await createResolvedRunFromCollection(input);
                scope.assert.equal(run.plan.kind, 'supervised');
                scope.assert.equal(run.facts.execution.testFamily, 'integration');
                scope.assert.equal(run.facts.benchmarkNormalization, null);
                scope.assert.equal(Object.isFrozen(run), true);
                scope.assert.deepEqual(run.collectionRunnerErrors, []);
                return scope.assert.collect();
            }
        );
    })
);
await runIfMain(import.meta, testNode);
