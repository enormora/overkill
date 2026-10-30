import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import {
    serializeValue,
    defineReporter,
    type PropertyCaseEvidence
} from '../packages/engine/engine.entry-point.ts';
import { propertyEvidenceSchema } from '../run/property-evidence-schema.ts';
import { formatPropertyDiagnostics } from '../reporters/failure-summary.ts';
import { gen } from './generators.ts';
import { property } from './property-authoring.ts';

async function observedUnrelatedFailure(): Promise<PropertyCaseEvidence> {
    const result = await executePropertyNode(
        property({
            title: 'transported diagnostics',
            generator: gen.integer({ min: 0, max: 100 }),
            examples: [ function () {
                return 100;
            } ],
            test(value, sample) {
                if (value === 0) {
                    sample.assert.fail({ message: 'unrelated zero input' });
                }
                sample.assert.true(value < 6);
                return sample.assert.collect();
            }
        }),
        propertyExecutionDefaults
    );
    const encodedEvidence = JSON.stringify(result.perTest[0]?.property);
    return propertyEvidenceSchema.parse(JSON.parse(encodedEvidence));
}

function withAdapterDiagnostic(evidence: PropertyCaseEvidence): PropertyCaseEvidence {
    return {
        invocations: evidence.invocations.map(function extend(invocation) {
            return {
                ...invocation,
                diagnostics: [ ...invocation.diagnostics, { reason: 'adapter diagnostic', observation: null } ]
            };
        })
    };
}

const rejectPropertyProgress = defineReporter(function rejectCheckpoints() {
    return {
        kind: 'real-time',
        name: 'reject property checkpoints',
        sinks: [],
        dispose: null,
        onFinish: null,
        onEvent(event) {
            if (event.kind === 'property-progress') {
                throw new Error('Property checkpoint delivery failed.');
            }
        }
    };
});

export const testNode = suite('shrink failure paths', [
    test('retains an example when compatible shrink state is unavailable', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'mapped example without provenance',
                generator: gen.integer({ min: 0, max: 100 }).map(function fresh(value) {
                    return { value };
                }),
                examples: [ function () {
                    return { value: 100 };
                } ],
                test(_value, sample) {
                    calls += 1;
                    sample.assert.fail({ message: 'original example failure' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.perTest[0]?.property?.invocations[0]?.shrinkStatus, 'shrink-state-unavailable');
        scope.assert.includes(JSON.stringify(result.perTest[0]?.property), 'original example failure');
        return scope.assert.collect();
    }),
    test('reports checkpoint delivery errors without losing failure evidence', async function (scope) {
        const node = property({
            title: 'failed checkpoint delivery',
            generator: gen.constant(1),
            test(_value, sample) {
                sample.assert.fail({ message: 'retained assertion failure' });
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, {
            ...propertyExecutionDefaults,
            reporters: [ rejectPropertyProgress ]
        });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.runnerErrors), 'Property checkpoint delivery failed.');
        scope.assert.includes(JSON.stringify(result.perTest[0]?.property), 'retained assertion failure');
        scope.assert.equal(result.perTest[0]?.property?.invocations[0]?.shrinkStatus, 'search-exhausted');
        return scope.assert.collect();
    }),
    test('explicit keys distinguish failures at the same assertion location', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'semantic key distinction',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    sample.failureKey(value === 100 ? 'original state' : 'different state');
                    sample.assert.fail({ message: 'same assertion location' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(
            JSON.stringify(result.perTest[0]?.property?.invocations[0]?.retained.input),
            JSON.stringify(serializeValue(100))
        );
        scope.assert.includes(JSON.stringify(result.perTest[0]?.property), 'unrelated-failure');
        return scope.assert.collect();
    }),
    test('transports diagnostic snapshots and renders grouped failures', async function (scope) {
        const evidence = await observedUnrelatedFailure();
        const count = evidence.invocations.reduce(function unrelatedCount(total, invocation) {
            return total + invocation
                .diagnostics
                .filter(function unrelated(diagnostic) {
                    return diagnostic.reason === 'unrelated-failure';
                })
                .length;
        }, 0);
        scope.assert.true(count > 0);
        scope.assert.deepEqual(
            evidence.invocations.map(function original(invocation) {
                return invocation.original.input;
            }),
            [ serializeValue(100) ]
        );
        scope.assert.deepEqual(
            evidence.invocations.map(function retained(invocation) {
                return invocation.retained.input;
            }),
            [ serializeValue(6) ]
        );
        scope.assert.deepEqual(formatPropertyDiagnostics(withAdapterDiagnostic(evidence)), [
            `Property declared-property: Unrelated failures observed during shrinking (${count})`,
            'Property declared-property: adapter diagnostic (1)',
            'Property declared-property: Shrinking exhausted the candidate search (1)'
        ]);
        return scope.assert.collect();
    }),

    test('reads historical evidence without inventing a termination status', async function (scope) {
        const evidence = await observedUnrelatedFailure();
        const historical = {
            invocations: evidence.invocations.map(function legacy(invocation) {
                return Object.fromEntries(
                    Object.entries(invocation).filter(function historicalField([ key ]) {
                        return key !== 'shrinkStatus';
                    })
                );
            })
        };
        const decoded = propertyEvidenceSchema.parse(historical);
        scope.assert.equal(decoded.invocations[0]?.shrinkStatus, null);
        scope.assert.throws(function invalidStatus() {
            propertyEvidenceSchema.parse({
                invocations: evidence.invocations.map(function malformed(invocation) {
                    return { ...invocation, shrinkStatus: 'unknown-status' };
                })
            });
        }, { name: 'ZodError' });
        return scope.assert.collect();
    }),
    test('rejects nonstring and blank stable keys before admitting another input', async function (scope) {
        for (const key of [ undefined, 42, '', ' '.repeat(3) ]) {
            let calls = 0;
            const result = await executePropertyNode(
                property({
                    title: 'invalid failure key',
                    generator: gen.constant(1),
                    test(_value, sample) {
                        calls += 1;
                        Reflect.apply(sample.failureKey, undefined, [ key ]);
                        return sample.assert.collect();
                    }
                }),
                propertyExecutionDefaults
            );
            scope.assert.equal(calls, 1);
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.includes(JSON.stringify(result.perTest), 'property-observation');
        }
        return scope.assert.collect();
    }),
    test('retains non-error throws without attempting to shrink them', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'non-error throw',
                generator: gen.integer({ min: 0, max: 100 }),
                test() {
                    calls += 1;
                    const failure: unknown = 42;
                    throw failure;
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'failure-identity-unavailable');
        return scope.assert.collect();
    }),
    test('retains errors whose stacks contain no originating location', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'missing throw location',
                generator: gen.integer({ min: 0, max: 100 }),
                test() {
                    calls += 1;
                    const failure = new Error('no recorded throw location');
                    Object.defineProperty(failure, 'stack', { value: 'Error: no recorded throw location' });
                    throw failure;
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'failure-identity-unavailable');
        return scope.assert.collect();
    }),
    test('retains errors without reliable constructor metadata', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'missing exception constructor',
                generator: gen.integer({ min: 0, max: 100 }),
                test() {
                    calls += 1;
                    const failure = new Error('unclassified error');
                    const prototype = {};
                    Object.setPrototypeOf(prototype, Error.prototype);
                    Object.setPrototypeOf(failure, prototype);
                    throw failure;
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'failure-identity-unavailable');
        return scope.assert.collect();
    }),
    test('retains the failure when reconstruction exhausts the shrink budget', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'confirmation budget',
                generator: gen.integer({ min: 100, max: 1000 }),
                settings: { maxShrinkWork: 1 },
                test(value, sample) {
                    calls += 1;
                    sample.assert.true(value < 100);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.inconclusive, 0);
        scope.assert.includes(JSON.stringify(result.perTest), 'work-exhausted');
        return scope.assert.collect();
    }),
    test('keeps cleanup failures during confirmation as native outcomes', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'confirmation cleanup',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(_value, sample) {
                    calls += 1;
                    sample.cleanup(function cleanup() {
                        if (calls === 2) {
                            throw new Error('confirmation cleanup failed');
                        }
                    });
                    sample.assert.fail({ message: 'original assertion' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 2);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'cleanup-error');
        scope.assert.includes(JSON.stringify(result.perTest[0]?.property), 'original assertion');
        return scope.assert.collect();
    }),
    test('keeps shrink callback exceptions visible with the original failure evidence', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'shrink callback error',
                generator: gen.integer({ min: 0, max: 1_000_000_000 }).map(function rejectZero(value) {
                    if (value === 0) {
                        throw new Error('shrink callback exploded');
                    }
                    return value;
                }),
                test(_value, sample) {
                    calls += 1;
                    sample.assert.fail({ message: 'original assertion' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 2);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'shrink callback exploded');
        scope.assert.includes(JSON.stringify(result.perTest[0]?.property), 'execution-error');
        scope.assert.includes(JSON.stringify(result.perTest[0]?.property), 'original assertion');
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
