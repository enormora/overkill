import { createClock } from '@enormora/clock';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { OrdinaryBaselineAdapter } from '../baselines/ordinary-baseline-adapter.ts';
import { baselineCaseEvent, baselineCaseResult } from '../test-support/baseline-case-fixture.ts';
import { createOrdinaryBaselineFixture } from '../test-support/ordinary-baseline-fixture.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { createOrdinaryBaselineWorkflow, type OrdinaryBaselineWorkflow } from './baseline-workflow.ts';
import { createOrdinaryBaselineSession } from './baseline-session.ts';

type WorkflowFixture = { readonly workflow: OrdinaryBaselineWorkflow; readonly observations: () => number; };
async function workflowFixture(
    scope: TestScope,
    evaluate: OrdinaryBaselineAdapter['evaluate']
): Promise<WorkflowFixture> {
    const data = await createOrdinaryBaselineFixture(scope, 'in-process', 'text');
    let observations = 0;
    const workflow = await createOrdinaryBaselineWorkflow({
        policy: {
            directory: data.directory,
            snapshots: false,
            stale: 'fail',
            adapters: [ {
                ...data.adapter,
                async evaluate(input) {
                    observations += 1;
                    return await evaluate(input);
                }
            } ]
        },
        projectRoot: process.cwd(),
        request: defaultRunRequest({ profile: 'unit', baselineUpdateMode: 'update' }),
        maxBytes: 65_536
    });
    return {
        workflow,
        observations() {
            return observations;
        }
    };
}
export const testNode = suite('ordinary baseline event lifecycle', [
    test('blocks publication when its retained report exceeds the artifact limit', async function (scope: TestScope) {
        const fixture = await workflowFixture(scope, async function () {
            return { kind: 'observed', comparison: null, proposal: { kind: 'text', text: '42' } };
        });
        await fixture.workflow.evaluate(baselineCaseEvent);
        const dispatcher = createReporterDispatcher({
            wallClock: createClock(),
            stdout: {
                writeLine() {
                    return undefined;
                }
            },
            stderr: {
                writeLine() {
                    return undefined;
                }
            }
        });
        const session = createOrdinaryBaselineSession({
            workflow: fixture.workflow,
            dispatcher,
            maxBytes: 1,
            mode: 'update'
        });
        const result = await session.finalize(fixture.workflow.prepareResult(baselineCaseResult));
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.runnerErrors.length, 2);
        scope.assert.deepEqual(result.artifacts, []);
        scope.assert.deepEqual(await fixture.workflow.store.list(), []);
        return scope.assert.collect();
    }),
    test('ignores skipped and intermediate retry events', async function (scope: TestScope) {
        const fixture = await workflowFixture(scope, async function () {
            throw new Error('Unexpected observation.');
        });
        for (
            const event of [
                { ...baselineCaseEvent, completion: 'retry' as const },
                {
                    ...baselineCaseEvent,
                    verdict: 'skip' as const,
                    outcome: { kind: 'skip' as const, reason: 'Unavailable.' }
                }
            ]
        ) {
            const evaluated = await fixture.workflow.evaluate(event);
            scope.assert.equal(evaluated.event, event);
            scope.assert.deepEqual(evaluated.errors, []);
        }
        scope.assert.equal(fixture.observations(), 0);
        return scope.assert.collect();
    }),
    test('does not propose changes for inapplicable adapters', async function (scope: TestScope) {
        const fixture = await workflowFixture(scope, async function () {
            return { kind: 'not-applicable' };
        });
        const evaluated = await fixture.workflow.evaluate(baselineCaseEvent);
        scope.assert.equal(evaluated.event, baselineCaseEvent);
        scope.assert.deepEqual(evaluated.errors, []);
        scope.assert.equal(fixture.workflow.prepareResult(baselineCaseResult).status, 'passed');
        scope.assert.deepEqual(fixture.workflow.changes, []);
        return scope.assert.collect();
    }),
    test('shares concurrent observations and reconciles their proposals once', async function (scope: TestScope) {
        const fixture = await workflowFixture(scope, async function () {
            return { kind: 'observed', comparison: null, proposal: { kind: 'text', text: '42' } };
        });
        const [ first, second ] = await Promise.all([
            fixture.workflow.evaluate(baselineCaseEvent),
            fixture.workflow.evaluate(baselineCaseEvent)
        ]);
        scope.assert.equal(first, second);
        scope.assert.equal(fixture.observations(), 1);
        const prepared = fixture.workflow.prepareResult(baselineCaseResult);
        scope.assert.equal(fixture.workflow.finish(prepared), prepared);
        scope.assert.equal(fixture.workflow.changes.length, 1);
        scope.assert.equal(fixture.workflow.changes[0]?.kind, 'create');
        return scope.assert.collect();
    })
]);
