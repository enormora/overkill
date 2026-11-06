import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import type { RunResult, TestScope } from '../packages/engine/engine.entry-point.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

function assertConfirmedRecipe(scope: TestScope, result: RunResult, phase: string): void {
    const evidence = result.perTest[0]?.property?.invocations[0];
    scope.require.defined(evidence);
    scope.require.notNull(evidence.summary);
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.equal(evidence.summary.accounting.phases.confirmation.executed, 1);
    scope.assert.equal(evidence.original?.trial?.phase, phase);
    scope.assert.equal(evidence.shrinkStatus, 'shrink-state-unavailable');
    scope.assert.notNull(evidence.confirmedWitness);
}

export const testNode = suite('input recipe confirmation', [
    ...([ 'examples', 'automatic-edges', 'exhaustive' ] as const).map(function recipePhase(phase) {
        return test(`confirms fresh ${phase} inputs without shrink state`, async function (scope: TestScope) {
            const seen: number[] = [];
            const result = await executePropertyNode(
                property({
                    title: 'mapped recipe',
                    generator: gen.integer({ min: 0, max: 1 }).map(function fresh(value) {
                        return { value };
                    }),
                    examples: phase === 'examples'
                        ? [ function example() {
                            return { value: 42 };
                        } ]
                        : [],
                    test(input, sample) {
                        seen.push(input.value);
                        Object.assign(input, { value: -1 });
                        sample.failureKey('recipe');
                        sample.assert.fail();
                        return sample.assert.collect();
                    }
                }),
                {
                    ...propertyExecutionDefaults,
                    policy: {
                        ...propertyExecutionDefaults.policy,
                        maxAutomaticEdges: phase === 'automatic-edges' ? 100 : 0,
                        maxExhaustiveValues: phase === 'exhaustive' ? 100 : 0
                    }
                }
            );
            scope.assert.deepEqual(seen, phase === 'examples' ? [ 42, 42 ] : [ 0, 0 ]);
            assertConfirmedRecipe(scope, result, phase);
            return scope.assert.collect();
        });
    }),
    test('detects non-reproducible examples before requiring shrink state', async function (scope: TestScope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'unstable recipe',
                generator: gen.constant<number>(1).map(function fresh(value) {
                    return { value };
                }),
                examples: [ function example() {
                    return { value: 1 };
                } ],
                test(_input, sample) {
                    calls += 1;
                    sample.failureKey('recipe');
                    sample.assert.equal(calls, 2);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        const evidence = result.perTest[0]?.property?.invocations[0];
        scope.require.defined(evidence);
        scope.assert.equal(calls, 2);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(evidence.shrinkStatus, 'non-reproducible');
        scope.assert.equal(evidence.confirmedWitness, null);
        scope.assert.true(evidence.diagnostics.some(function disagreement(diagnostic) {
            return diagnostic.reason === 'non-reproducible' && diagnostic.observation !== null;
        }));
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
