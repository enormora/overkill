import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite, test, type TestScope } from '@overkill-dev/test';

import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import type { RunResult } from '../packages/engine/engine.entry-point.ts';

import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

const assertConfirmedRecipe = defineCompositeAssertion({
    name: 'confirmed recipe',
    assert(check, result: RunResult, phase: string) {
        const evidence = result.perTest[0]?.property?.invocations[0];
        if (evidence === undefined || evidence === null) {
            return check.defined(evidence);
        }
        if (evidence.summary === null) {
            return check.notNull(evidence.summary);
        }
        return check.group([
            check.equal(result.summary.failed, 1),
            check.equal(evidence.summary.accounting.phases.confirmation.executed, 1),
            check.equal(evidence.original?.trial?.phase, phase),
            check.equal(evidence.shrinkStatus, 'shrink-state-unavailable'),
            check.notNull(evidence.confirmedWitness)
        ]);
    }
});

export const testNode = suite('input recipe confirmation', [
    table({
        title: 'confirms fresh inputs without shrink state',
        cases: [ 'examples', 'automatic-edges', 'exhaustive' ] as const,
        caseTitle(phase) {
            return phase;
        },
        async test(scope) {
            const phase = scope.parameters;

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
            scope.assert(assertConfirmedRecipe, result, phase);
            return scope.assert.collect();
        }
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
