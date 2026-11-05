import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    defineReporter,
    readPropertyExecutionHost,
    type PropertyCaseEvidence,
    type RunResult,
    type TestScope,
    type TestNode
} from '../packages/engine/engine.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { formatPropertyDiagnostics } from '../reporters/failure-summary.ts';
import { propertyEvidenceSchema } from '../run/property-evidence-schema.ts';
import { property, withProperties } from './property-authoring.ts';
import { normalizePropertyInvocation } from './property-invocation.ts';
import { replayPropertyInvocation } from './property-replay.ts';
import { gen } from './generators.ts';

function casePropertyEvidence(result: RunResult): PropertyCaseEvidence {
    const evidence = result.perTest[0]?.property;
    if (evidence === null || evidence === undefined) {
        throw new Error('Expected property evidence from the executed case.');
    }
    return evidence;
}

function diagnosticProperty(expected: number): TestNode {
    return property({
        title: 'diagnostic failure',
        generator: gen.constant(1),
        test(value, sample) {
            sample.assert.equal(value, expected);
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
    test('exhaustive completion does not hide unmet input coverage', async function (scope: TestScope) {
        const result = await executePropertyNode(
            property({
                title: 'unmet exhaustive coverage',
                generator: gen.constant<number>(0),
                coverage: [ { label: 'positive', minimumPercent: 100 } ],
                test(value, sample) {
                    sample.cover('positive', value > 0);
                    sample.assert.equal(value, 0);
                    return sample.assert.collect();
                }
            }),
            { ...propertyExecutionDefaults, policy: { ...propertyExecutionDefaults.policy, maxExhaustiveValues: 10 } }
        );
        const evidence = propertyEvidenceSchema.parse(casePropertyEvidence(result));
        const lines = formatPropertyDiagnostics(evidence).join('\n');
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.includes(lines, 'coverage-unmet');
        scope.assert.includes(lines, 'Exhaustive traversal complete: 1/1');
        scope.assert.includes(lines, 'Required input coverage positive: 0/1 (0%), minimum 100%');
        return scope.assert.collect();
    }),
    test('historical evidence renders diagnostics without inventing a summary', async function (scope: TestScope) {
        const evidence = casePropertyEvidence(
            await executePropertyNode(diagnosticProperty(0), propertyExecutionDefaults)
        );
        const historical = {
            invocations: evidence.invocations.map(function legacy(invocation) {
                return Object.fromEntries(
                    Object.entries(invocation).filter(function historicalField([ field ]) {
                        return field !== 'summary';
                    })
                );
            })
        };
        const decoded = propertyEvidenceSchema.parse(historical);
        const lines = formatPropertyDiagnostics(decoded).join('\n');
        scope.assert.equal(decoded.invocations[0]?.summary, null);
        scope.assert.includes(lines, 'Shrinking exhausted the candidate search');
        scope.assert.false(lines.includes('run seed='));
        return scope.assert.collect();
    }),
    test('renders the original witness seed separately during direct replay', async function (scope: TestScope) {
        const node = diagnosticProperty(0);
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
    test(
        'successful witness replay has no failure observations or counterexample diagnostic',
        async function (scope: TestScope) {
            const failure = casePropertyEvidence(
                await executePropertyNode(diagnosticProperty(0), propertyExecutionDefaults)
            );
            const witness = failure.invocations[0]?.confirmedWitness;
            scope.require.defined(witness);
            const replay = await executePropertyNode(diagnosticProperty(1), {
                ...propertyExecutionDefaults,
                replay: witness
            });
            const evidence = casePropertyEvidence(replay);
            scope.assert.equal(replay.summary.passed, 1);
            scope.assert.equal(evidence.invocations[0]?.original, null);
            scope.assert.equal(evidence.invocations[0]?.retained, null);
            scope.assert.false(formatPropertyDiagnostics(evidence).join('\n').includes('Shrunk counterexample'));
            return scope.assert.collect();
        }
    ),
    test(
        'replay keeps cleanup failures native and marks the invocation interrupted',
        async function (scope: TestScope) {
            let cleanupFailure: Error | null = null;
            const node = property({
                title: 'cleanup replay',
                generator: gen.constant(1),
                test(value, sample) {
                    sample.cleanup(function failReplayCleanup() {
                        if (cleanupFailure !== null) {
                            throw cleanupFailure;
                        }
                    });
                    sample.assert.equal(value, 0);
                    return sample.assert.collect();
                }
            });
            const witness = casePropertyEvidence(await executePropertyNode(node, propertyExecutionDefaults))
                .invocations[0]
                ?.confirmedWitness;
            scope.require.defined(witness);
            cleanupFailure = new Error('Replay cleanup failed.');
            const replay = await executePropertyNode(node, { ...propertyExecutionDefaults, replay: witness });
            scope.assert.equal(replay.summary.failed, 1);
            scope.assert.includes(JSON.stringify(replay.perTest[0]?.outcome), 'cleanup-error');
            scope.assert.equal(casePropertyEvidence(replay).invocations[0]?.summary?.status, 'interrupted');
            return scope.assert.collect();
        }
    ),
    test(
        'incompatible or foreign replay input records an execution error without evaluating a trial',
        async function (scope: TestScope) {
            const witness = casePropertyEvidence(
                await executePropertyNode(diagnosticProperty(0), propertyExecutionDefaults)
            )
                .invocations[0]
                ?.confirmedWitness;
            scope.require.defined(witness);
            const invalidWitnesses = [
                {
                    ...witness,
                    counterexample: {
                        ...witness.counterexample,
                        format: { name: 'unknown-property-format', version: 1 }
                    }
                },
                { ...witness, case: { ...witness.case, title: 'another property' } }
            ];
            for (const replayWitness of invalidWitnesses) {
                const replay = await executePropertyNode(diagnosticProperty(0), {
                    ...propertyExecutionDefaults,
                    replay: replayWitness
                });
                const summary = casePropertyEvidence(replay).invocations[0]?.summary;
                scope.assert.equal(summary?.status, 'execution-error');
                scope.assert.equal(summary?.accounting.phases.witness.executed, 0);
                scope.assert.true(replay.runnerErrors.some(function replayError(error) {
                    return error.subtype === 'witness-replay';
                }));
            }
            return scope.assert.collect();
        }
    ),
    test('canceled replay records interruption before admitting a trial', async function (scope: TestScope) {
        const controller = new AbortController();
        let calls = 0;
        const witness = casePropertyEvidence(
            await executePropertyNode(diagnosticProperty(0), propertyExecutionDefaults)
        )
            .invocations[0]
            ?.confirmedWitness;
        scope.require.defined(witness);
        const node = test(
            'diagnostic failure',
            withProperties(async function (parent) {
                const invocation = normalizePropertyInvocation({
                    generator: gen.constant(1),
                    test(_value, sample) {
                        calls += 1;
                        sample.assert.fail({ message: 'Canceled replay evaluated a trial.' });
                        return sample.assert.collect();
                    }
                });
                await replayPropertyInvocation(invocation, {
                    host: readPropertyExecutionHost(parent),
                    signal: controller.signal,
                    identity: 'declared-property',
                    locations: [ { kind: 'unknown' } ]
                }, witness);
                return parent.assert.collect();
            })
        );
        const result = await executePropertyNode(node, {
            ...propertyExecutionDefaults,
            reporters: [ defineReporter(function cancelReplay() {
                return {
                    kind: 'real-time',
                    name: 'cancel replay',
                    sinks: [],
                    dispose: null,
                    onFinish: null,
                    onEvent(event) {
                        if (
                            event.kind === 'property-progress'
                        ) {
                            controller.abort(new Error('Cancel replay.'));
                        }
                    }
                };
            }) ]
        });
        scope.assert.equal(casePropertyEvidence(result).invocations[0]?.summary?.status, 'interrupted');
        scope.assert.deepEqual({ failed: result.summary.failed, calls, errors: result.runnerErrors.length }, {
            failed: 1,
            calls: 0,
            errors: 0
        });
        scope.assert.includes(
            JSON.stringify(result.perTest[0]?.outcome),
            'Property invocation canceled after a scope-contract violation.'
        );
        return scope.assert.collect();
    }),
    test('rejects evidence with only one failure observation', async function (scope: TestScope) {
        const evidence = casePropertyEvidence(
            await executePropertyNode(diagnosticProperty(0), propertyExecutionDefaults)
        );
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
