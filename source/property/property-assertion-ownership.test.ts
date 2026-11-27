import { test } from '@overkill-dev/test';
import { test as subjectTest } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { withProperties } from './property-authoring.ts';
import { gen } from './generators.ts';

function rejectedOperations(operations: readonly (() => void)[]): number {
    let rejected = 0;
    for (const operation of operations) {
        try {
            operation();
        } catch {
            rejected += 1;
        }
    }
    return rejected;
}

export const testNode = test('retains caught outer assertion operations in the trial', async function (scope) {
        let trials = 0;
        let rejected = 0;
        const node = subjectTest('captured facade', withProperties(async function (parent) {
            const outerOperations = [
                function recordOuterAssertion() {
                    parent.assert.true(true);
                },
                function recordOuterRequirement() {
                    Reflect.apply(parent.require.boolean, undefined, [ true ]);
                },
                function collectOuterAssertions() {
                    parent.assert.collect();
                },
                function planOuterAssertions() {
                    parent.plan(1);
                }
            ];
            try {
                await parent.forall(gen.constant(1), async function (value, sample) {
                    trials += 1;
                    await Promise.resolve();
                    rejected += rejectedOperations(outerOperations);
                    try {
                        await parent.forall(gen.constant(1), function nestedTrial(input, nested) {
                            nested.assert.equal(input, 1);
                            return nested.assert.collect();
                        });
                    } catch {
                        rejected += 1;
                    }
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                });
            } catch {
                parent.assert.true(true);
            }
            return parent.assert.collect();
        }));
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(trials, 1);
        scope.assert.equal(rejected, 5);
        const outcome = result.perTest[0]?.outcome;
        scope.assert.deepEqual(
            outcome?.kind === 'fail'
                ? outcome.failures.map(function code(failure) {
                    return failure.kind === 'test-contract' ? failure.code : failure.kind;
                })
                : [],
            new Array<string>(5).fill('invalid-assertion-context')
        );
        return scope.assert.collect();
    });
