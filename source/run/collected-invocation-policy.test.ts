import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { passingIsolatedWorkerRun } from '../test-support/isolated-worker-run.ts';
import { observationPlan } from '../test-support/observation-lifetime.ts';
import { createCollectedPlan } from '../test-support/worker-pool-execution-state.ts';
import { defaultIntegrationProfile } from '../test-support/run-command-factory.ts';
import { createLocalResolvedRunFromTestPlan } from './run-local-planning.ts';
import { planCollectedInvocation, type CollectedRunContext } from './collected-run-planning.ts';

function collectedContext(): CollectedRunContext {
    const fixture = passingIsolatedWorkerRun(false, false);
    const profile = defaultIntegrationProfile({
        execution: { processModel: 'supervised-process', scheduling: 'serial' }
    });
    const config = { ...fixture.command.config, profiles: { integration: profile } };
    const command = { ...fixture.command, config };
    const input = { ...fixture.input, config, profile };
    const resolved = createLocalResolvedRunFromTestPlan(command, fixture.dependencies, input, observationPlan());
    if (resolved.plan.kind !== 'local') {
        throw new Error('Expected a local collected plan.');
    }
    return {
        command,
        dependencies: fixture.dependencies,
        input,
        resolved: { ...resolved, plan: resolved.plan },
        moduleBoundary: null
    };
}
export const testNode = suite('collected invocation selection policy', [
    test('plans an ordinary local invocation without replacing its selected case', async function (scope: TestScope) {
        const context = collectedContext();
        const result = await planCollectedInvocation(context, { selection: { kind: 'all' } });
        scope.assert.equal(result.kind, 'planned');
        scope.assert.equal(result.resolved.plan.kind, 'local');
        if (result.resolved.plan.kind !== 'local') {
            throw new Error('Expected selected local work.');
        }
        scope.assert.equal(result.resolved.plan.testPlan.cases[0].id.title, 'owned case');
        scope.assert.true(Object.isFrozen(result.resolved));
        return scope.assert.collect();
    }),
    test(
        'returns explicit empty-selection evidence when an invocation excludes every case',
        async function (scope: TestScope) {
            const result = await planCollectedInvocation(collectedContext(), { selection: { kind: 'none' } });
            scope.assert.equal(result.kind, 'empty-selection');
            if (result.kind !== 'empty-selection') {
                throw new Error('Expected empty selection evidence.');
            }
            scope.assert.equal(result.result.planStatus, 'empty-selection');
            scope.assert.equal(result.result.summary.planned, 0);
            scope.assert.equal(result.resolved.request.selection.kind, 'none');
            return scope.assert.collect();
        }
    ),
    test('preserves empty-shard plans while recording the invocation selection', async function (scope: TestScope) {
        const context = collectedContext();
        const collectedPlan = { ...createCollectedPlan(), files: [] };
        const result = await planCollectedInvocation({
            ...context,
            resolved: { ...context.resolved, plan: { kind: 'empty-shard', collectedPlan } }
        }, { selection: { kind: 'none' } });
        scope.assert.equal(result.kind, 'planned');
        scope.assert.equal(result.resolved.plan.kind, 'empty-shard');
        scope.assert.deepEqual(result.resolved.facts.reproducibility.selection, { kind: 'none' });
        scope.assert.true(Object.isFrozen(result.resolved));
        return scope.assert.collect();
    }),
    test('rejects malformed invocation selections before planning', async function (scope: TestScope) {
        const context = collectedContext();
        await scope.assert.rejects(async function () {
            await Reflect.apply(planCollectedInvocation, undefined, [ context, { selection: { kind: 'unknown' } } ]);
        }, { message: 'Run selection kind is unknown.' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
