import type { RunResult } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

async function budgetedReconstruction(failing: boolean): Promise<RunResult> {
    return await executePropertyNode(
        property({
            title: 'reconstruction budget',
            generator: gen.constant(null),
            test(_input, sample) {
                sample.assert.true(!failing);
                for (let index = 0; index < 100; index += 1) {
                    sample.reconstructInput();
                }
                return sample.assert.collect();
            }
        }),
        {
            ...propertyExecutionDefaults,
            policy: { ...propertyExecutionDefaults.policy, maxWork: 25, maxShrinkWork: 0, newTrials: 1 }
        }
    );
}

export const testNode = suite('property input reconstruction', [
    test('reports exhausted reconstruction work as inconclusive', async function (scope) {
        const result = await budgetedReconstruction(false);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.equal(result.perTest[0]?.property?.invocations[0]?.summary?.status, 'work-exhausted');
        return scope.assert.collect();
    }),
    test('preserves an established assertion failure when reconstruction exhausts work', async function (scope) {
        const result = await budgetedReconstruction(true);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.inconclusive, 0);
        return scope.assert.collect();
    })
]);
