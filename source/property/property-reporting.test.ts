import { runIfMain } from '#test-runner';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { propertyEvidenceSchema } from '../run/property-evidence-schema.ts';
import { formatPropertyDiagnostics } from '../reporters/failure-summary.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

export const testNode = suite('property reporting', [
    test('reports passing exploration without manufacturing a failure', async function (scope: TestScope) {
        const result = await executePropertyNode(
            property({
                title: 'passing coverage',
                generator: gen.integer({ min: 1, max: 5 }),
                coverage: [ { label: 'positive', minimumPercent: 100 } ],
                test(value, sample) {
                    sample.cover('positive', value > 0);
                    sample.assert.true(value > 0);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        const evidence = result.perTest[0]?.property;
        scope.require.defined(evidence);
        const invocation = evidence.invocations[0];
        scope.require.defined(invocation);
        const { summary } = invocation;
        scope.require.defined(summary);
        scope.assert.deepEqual({
            original: invocation.original,
            retained: invocation.retained,
            status: summary.status,
            executed: summary.accounting.phases.exploration.executed,
            denominator: summary.coverage.denominator,
            hits: summary.coverage.phases.exploration,
            seed: summary.runSeed,
            cases: result.perTest.length
        }, {
            original: null,
            retained: null,
            status: 'completed',
            executed: 3,
            denominator: 3,
            hits: { positive: 3 },
            seed: '42',
            cases: 1
        });
        scope.assert.deepEqual([
            propertyEvidenceSchema.parse(structuredClone(evidence)),
            formatPropertyDiagnostics(evidence).some(function phases(line) {
                return line.includes('exploration=3');
            })
        ], [ evidence, true ]);
        return scope.assert.collect();
    }),
    test('does not call partial exhaustive execution complete', async function (scope: TestScope) {
        const result = await executePropertyNode(
            property({
                title: 'finite failure',
                generator: gen.boolean(),
                test(value, sample) {
                    sample.assert.true(value);
                    return sample.assert.collect();
                }
            }),
            { ...propertyExecutionDefaults, policy: { ...propertyExecutionDefaults.policy, maxExhaustiveValues: 10 } }
        );
        const summary = result.perTest[0]?.property?.invocations[0]?.summary;
        scope.require.defined(summary);
        scope.assert.equal(summary.status, 'failed');
        scope.assert.equal(summary.exhaustive?.domainSize, 2);
        scope.assert.equal(summary.exhaustive?.traversal, 'incomplete');
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
