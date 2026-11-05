import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type { PropertyCaseEvidence, RunResult, TestScope, TestNode } from '../packages/engine/engine.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { formatPropertyDiagnostics } from '../reporters/failure-summary.ts';
import { propertyEvidenceSchema } from '../run/property-evidence-schema.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

function casePropertyEvidence(result: RunResult): PropertyCaseEvidence {
    const evidence = result.perTest[0]?.property;
    if (evidence === null || evidence === undefined) {
        throw new Error('Expected property evidence from the executed case.');
    }
    return evidence;
}

function failingProperty(): TestNode {
    return property({
        title: 'diagnostic failure',
        generator: gen.constant(1),
        test(value, sample) {
            sample.assert.equal(value, 0);
            return sample.assert.collect();
        }
    });
}

export const testNode = suite('property diagnostic rendering', [
    test(
        'reports unavailable coverage when the work budget prevents body evaluation',
        async function (scope: TestScope) {
            const result = await executePropertyNode(
                property({
                    title: 'unavailable coverage',
                    generator: gen.constant(1),
                    settings: { maxWork: 1 },
                    coverage: [ { label: 'positive', minimumPercent: 100 } ],
                    test(value, sample) {
                        sample.assert.equal(value, 1);
                        return sample.assert.collect();
                    }
                }),
                propertyExecutionDefaults
            );
            const evidence = casePropertyEvidence(result);
            scope.assert.equal(result.summary.inconclusive, 1);
            scope.assert.includes(
                formatPropertyDiagnostics(evidence).join('\n'),
                'Required input coverage positive: 0/0 (unavailable), minimum 100%'
            );
            return scope.assert.collect();
        }
    ),
    test('reports completed exhaustive traversal and eligible coverage', async function (scope: TestScope) {
        const result = await executePropertyNode(
            property({
                title: 'exhaustive coverage',
                generator: gen.integer({ min: 0, max: 1 }),
                coverage: [ { label: 'positive', minimumPercent: 50 } ],
                test(value, sample) {
                    sample.cover('positive', value > 0);
                    sample.assert.true(value >= 0);
                    return sample.assert.collect();
                }
            }),
            { ...propertyExecutionDefaults, policy: { ...propertyExecutionDefaults.policy, maxExhaustiveValues: 10 } }
        );
        const lines = formatPropertyDiagnostics(casePropertyEvidence(result)).join('\n');
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.includes(lines, 'Exhaustive traversal complete: 2/2');
        scope.assert.includes(lines, 'Required input coverage positive: 1/2 (50%), minimum 50%');
        return scope.assert.collect();
    }),
    test('renders the original witness seed separately during direct replay', async function (scope: TestScope) {
        const node = failingProperty();
        const failure = casePropertyEvidence(await executePropertyNode(node, propertyExecutionDefaults));
        const witness = failure.invocations[0]?.confirmedWitness;
        scope.require.defined(witness);
        const replay = await executePropertyNode(node, { ...propertyExecutionDefaults, replay: witness });
        const evidence = casePropertyEvidence(replay);
        scope.assert.equal(replay.summary.failed, 1);
        scope.assert.includes(formatPropertyDiagnostics(evidence).join('\n'), `Witness seed=${witness.seed}`);
        scope.assert.equal(evidence.invocations[0]?.summary?.accounting.phases.witness.executed, 1);
        return scope.assert.collect();
    }),
    test('rejects evidence with only one failure observation', async function (scope: TestScope) {
        const evidence = casePropertyEvidence(await executePropertyNode(failingProperty(), propertyExecutionDefaults));
        for (const field of [ 'original', 'retained' ]) {
            const invalid = {
                invocations: evidence.invocations.map(function removeObservation(invocation) {
                    return { ...invocation, [field]: null };
                })
            };
            scope.assert.throws(function decodeInvalidEvidence() {
                propertyEvidenceSchema.parse(invalid);
            }, { name: 'ZodError' });
        }
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
