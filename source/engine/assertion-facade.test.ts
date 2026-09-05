import { defineNarrowingCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { AssertionSource, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import {
    createRecordingAssertFacadeWithLocation,
    type AssertAssertionFacade
} from './assertion-facade.ts';

type AssertRecording = {
    readonly facade: AssertAssertionFacade;
    readonly records: readonly AssertAssertionNode[];
};

type AssertPayloadSamples = {
    readonly array: AssertAssertionNode | undefined;
    readonly between: AssertAssertionNode | undefined;
    readonly hasProperty: AssertAssertionNode | undefined;
    readonly instanceOf: AssertAssertionNode | undefined;
};

const testLocation: SourceLocation = { column: 7, file: '/test/assertion-facade.test.ts', line: 11 };

type InstanceOfAssertAssertionNode = Extract<AssertAssertionNode, { readonly check: 'instance-of'; }>;

const instanceOfAssertAssertionNode = defineNarrowingCompositeAssertion<
    AssertAssertionNode,
    InstanceOfAssertAssertionNode,
    readonly []
>({
    name: 'instance-of assert assertion node',
    narrows(actual): actual is InstanceOfAssertAssertionNode {
        return actual.check === 'instance-of';
    }
});

function captureTestLocation(): SourceLocation {
    return testLocation;
}

function assertionChecks(records: readonly AssertAssertionNode[]): readonly string[] {
    return records.map(function checkOf(record) {
        return record.check;
    });
}

function recordLocations(records: readonly AssertAssertionNode[]): readonly AssertAssertionNode['location'][] {
    return records.map(function locationOf(record) {
        return record.location;
    });
}

function expectedRecordLocations(records: readonly AssertAssertionNode[]): readonly AssertAssertionNode['location'][] {
    return records.map(function expectedLocation() {
        return testLocation;
    });
}

function recordSources(records: readonly AssertAssertionNode[]): readonly AssertionSource[] {
    return records.map(function sourceOf(record) {
        return record.source;
    });
}

function expectedRecordSources(
    records: readonly AssertAssertionNode[],
    source: AssertionSource
): readonly AssertionSource[] {
    return records.map(function expectedSource() {
        return source;
    });
}

function createAssertRecording(): AssertRecording {
    const records: AssertAssertionNode[] = [];
    const facade = createRecordingAssertFacadeWithLocation(
        {
            failContract(failure) {
                throw new Error(failure.summary);
            },
            recordAssert(assertion) {
                records.push(assertion);
            },
            recordPendingAssert() {
                return {
                    resolve(assertion) {
                        records.push(assertion);
                    }
                };
            }
        },
        null,
        captureTestLocation
    );

    return { facade, records };
}

function assertPayloadSamples(records: readonly AssertAssertionNode[]): AssertPayloadSamples {
    return {
        array: records.at(0),
        between: records.at(2),
        hasProperty: records.at(14),
        instanceOf: records.at(16)
    };
}
function recordAssertNodes(facade: AssertAssertionFacade): void {
    const actualFunction = function value(): void {
        return undefined;
    };
    const calls: readonly (() => void)[] = [
        function () {
            facade.array([ 1 ], { message: 'array' });
        },
        function () {
            facade.arrayContainsPartial([ { id: 1 } ], { id: 1 });
        },
        function () {
            facade.between(2, 1, 3);
        },
        function () {
            facade.boolean(true);
        },
        function () {
            facade.deepEqual({ id: 1 }, { id: 1 });
        },
        function () {
            facade.defined('value');
        },
        function () {
            facade.empty([]);
        },
        function () {
            facade.endsWith('value', 'ue');
        },
        function () {
            facade.equal(1, 1);
        },
        function () {
            facade.fail();
        },
        function () {
            facade.false(false);
        },
        function () {
            facade.function(actualFunction);
        },
        function () {
            facade.greaterThan(2, 1);
        },
        function () {
            facade.greaterThanOrEqual(2, 2);
        },
        function () {
            facade.hasProperty({ name: 'Ada' }, 'name');
        },
        function () {
            facade.includes('value', 'al');
        },
        function () {
            facade.instanceOf(new Error('boom'), Error);
        },
        function () {
            facade.length([ 1, 2 ], 2);
        },
        function () {
            facade.lessThan(1, 2);
        },
        function () {
            facade.lessThanOrEqual(2, 2);
        },
        function () {
            facade.match('value', /^value/u);
        },
        function () {
            facade.membersPartialDeepEqual([ { id: 1 } ], [ { id: 1 } ]);
        },
        function () {
            facade.notDeepEqual({ id: 1 }, { id: 2 });
        },
        function () {
            facade.notEmpty([ 1 ]);
        },
        function () {
            facade.notEqual(1, 2);
        },
        function () {
            facade.notMatch('value', /^other/u);
        },
        function () {
            facade.notNull('value');
        },
        function () {
            facade.null(null);
        },
        function () {
            facade.number(1);
        },
        function () {
            facade.object({ id: 1 });
        },
        function () {
            facade.partialDeepEqual({ id: 1, name: 'Ada' }, { id: 1 });
        },
        function () {
            facade.startsWith('value', 'val');
        },
        function () {
            facade.string('value');
        },
        function () {
            facade.true(true);
        },
        function () {
            facade.undefined(undefined);
        },
        function () {
            facade.throws(function throwExpectedError() {
                throw new Error('expected');
            }, { message: 'expected' });
        }
    ];

    calls.forEach(function recordAssertion(callAssertion) {
        callAssertion();
    });
}

export const testSuite = createOverkillSuite({
    title: 'source/engine/assertion-facade.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'createRecordingAssertFacade() records every built-in assertion node',
            metadata: {},
            body(scope: OverkillScope) {
                const recording = createAssertRecording();

                recordAssertNodes(recording.facade);

                scope.assert.deepEqual(assertionChecks(recording.records), [
                    'array',
                    'array-contains-partial',
                    'between',
                    'boolean',
                    'deep-equal',
                    'defined',
                    'empty',
                    'ends-with',
                    'equal',
                    'fail',
                    'false',
                    'function',
                    'greater-than',
                    'greater-than-or-equal',
                    'has-property',
                    'includes',
                    'instance-of',
                    'length',
                    'less-than',
                    'less-than-or-equal',
                    'match',
                    'members-partial-deep-equal',
                    'not-deep-equal',
                    'not-empty',
                    'not-equal',
                    'not-match',
                    'not-null',
                    'null',
                    'number',
                    'object',
                    'partial-deep-equal',
                    'starts-with',
                    'string',
                    'true',
                    'undefined',
                    'composite'
                ]);
                scope.assert.deepEqual(
                    recordSources(recording.records),
                    expectedRecordSources(recording.records, 'assert')
                );
                scope.assert.deepEqual(recordLocations(recording.records), expectedRecordLocations(recording.records));

                const samples = assertPayloadSamples(recording.records);
                scope.require.defined(samples.instanceOf);
                scope.require(instanceOfAssertAssertionNode, samples.instanceOf);
                scope.assert.deepEqual(
                    {
                        array: samples.array,
                        between: samples.between,
                        hasProperty: samples.hasProperty,
                        instanceOf: samples.instanceOf
                    },
                    {
                        array: {
                            actual: [ 1 ],
                            check: 'array',
                            location: testLocation,
                            message: 'array',
                            source: 'assert'
                        },
                        between: {
                            actual: 2,
                            check: 'between',
                            location: testLocation,
                            maximum: 3,
                            message: null,
                            minimum: 1,
                            source: 'assert'
                        },
                        hasProperty: {
                            actual: { name: 'Ada' },
                            check: 'has-property',
                            key: 'name',
                            location: testLocation,
                            message: null,
                            source: 'assert'
                        },
                        instanceOf: {
                            actual: samples.instanceOf.actual,
                            check: 'instance-of',
                            expected: Error,
                            location: testLocation,
                            message: null,
                            source: 'assert'
                        }
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createRecordingAssertFacade() records async rejects assertions through pending sink',
            metadata: {},
            async body(scope: OverkillScope) {
                const recording = createAssertRecording();

                await recording.facade.rejects(async function rejectExpectedError() {
                    await Promise.reject(new Error('expected'));
                }, { message: 'expected' });

                scope.assert.deepEqual(assertionChecks(recording.records), [ 'composite' ]);
                scope.assert.deepEqual(
                    recordSources(recording.records),
                    expectedRecordSources(recording.records, 'assert')
                );
                scope.assert.deepEqual(recordLocations(recording.records), expectedRecordLocations(recording.records));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createRecordingAssertFacade() applies annotated messages without requiring the builder API',
            metadata: {},
            body(scope: OverkillScope) {
                const recording = createAssertRecording();

                recording.facade.annotated('annotated value').empty([]);
                recording.facade.annotated('base message').empty([], { message: 'option value' });

                scope.assert.deepEqual(
                    recording.records.map(function messageOf(record) {
                        return record.message;
                    }),
                    [ 'annotated value', 'option value' ]
                );
                scope.assert.equal(Object.hasOwn(recording.facade, 'collect'), false);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
