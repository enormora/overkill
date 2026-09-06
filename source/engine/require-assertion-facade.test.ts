import { defineNarrowingCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RequireAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { AssertionSource, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import {
    createRecordingRequireFacadeWithLocation,
    type RequireAssertionFacade
} from './require-assertion-facade.ts';

type RequireRecording = {
    readonly facade: RequireAssertionFacade;
    readonly records: readonly RequireAssertionNode[];
};

type RequirePayloadSamples = {
    readonly array: RequireAssertionNode | undefined;
    readonly hasProperty: RequireAssertionNode | undefined;
    readonly instanceOf: RequireAssertionNode | undefined;
};

const testLocation: SourceLocation = { column: 7, file: '/test/require-assertion-facade.test.ts', line: 11 };

type InstanceOfRequireAssertionNode = Extract<RequireAssertionNode, { readonly check: 'instance-of'; }>;

const instanceOfRequireAssertionNode = defineNarrowingCompositeAssertion<
    RequireAssertionNode,
    InstanceOfRequireAssertionNode,
    readonly []
>({
    name: 'instance-of require assertion node',
    narrows(actual): actual is InstanceOfRequireAssertionNode {
        return actual.check === 'instance-of';
    }
});

function captureTestLocation(): SourceLocation {
    return testLocation;
}

function assertionChecks(records: readonly RequireAssertionNode[]): readonly string[] {
    return records.map(function checkOf(record) {
        return record.check;
    });
}

function recordLocations(records: readonly RequireAssertionNode[]): readonly RequireAssertionNode['location'][] {
    return records.map(function locationOf(record) {
        return record.location;
    });
}

function expectedRecordLocations(
    records: readonly RequireAssertionNode[]
): readonly RequireAssertionNode['location'][] {
    return records.map(function expectedLocation() {
        return testLocation;
    });
}

function recordSources(records: readonly RequireAssertionNode[]): readonly AssertionSource[] {
    return records.map(function sourceOf(record) {
        return record.source;
    });
}

function expectedRecordSources(
    records: readonly RequireAssertionNode[],
    source: AssertionSource
): readonly AssertionSource[] {
    return records.map(function expectedSource() {
        return source;
    });
}

function createRequireRecording(): RequireRecording {
    const records: RequireAssertionNode[] = [];
    const facade = createRecordingRequireFacadeWithLocation(
        {
            failContract(failure) {
                throw new Error(failure.summary);
            },
            recordRequire(assertion) {
                records.push(assertion);
            }
        },
        null,
        captureTestLocation
    );

    return { facade, records };
}

function requirePayloadSamples(records: readonly RequireAssertionNode[]): RequirePayloadSamples {
    return {
        array: records.at(0),
        hasProperty: records.at(3),
        instanceOf: records.at(4)
    };
}

function recordValueRequireNodes(facade: RequireAssertionFacade): void {
    facade.array([ 1 ], { message: 'array' });
    facade.boolean(true);
    facade.defined('value');
    facade.hasProperty({ name: 'Ada' }, 'name');
    facade.instanceOf(new Error('boom'), Error);
}

function recordTypeRequireNodes(facade: RequireAssertionFacade): void {
    const actualFunction = function value(): void {
        return undefined;
    };

    facade.function(actualFunction);
    facade.notNull('value');
    facade.null(null);
    facade.number(1);
    facade.object({ id: 1 });
    facade.string('value');
}

function recordRequireNodes(facade: RequireAssertionFacade): void {
    recordValueRequireNodes(facade);
    recordTypeRequireNodes(facade);
}

export const testSuite = createOverkillSuite({
    title: 'source/engine/require-assertion-facade.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'createRecordingRequireFacade() records every built-in requirement node',
            metadata: {},
            body(scope: OverkillScope) {
                const recording = createRequireRecording();

                recordRequireNodes(recording.facade);

                scope.assert.deepEqual(assertionChecks(recording.records), [
                    'array',
                    'boolean',
                    'defined',
                    'has-property',
                    'instance-of',
                    'function',
                    'not-null',
                    'null',
                    'number',
                    'object',
                    'string'
                ]);
                scope.assert.deepEqual(
                    recordSources(recording.records),
                    expectedRecordSources(recording.records, 'require')
                );
                scope.assert.deepEqual(recordLocations(recording.records), expectedRecordLocations(recording.records));

                const samples = requirePayloadSamples(recording.records);
                scope.require.defined(samples.instanceOf);
                scope.require(instanceOfRequireAssertionNode, samples.instanceOf);
                scope.assert.deepEqual(
                    {
                        array: samples.array,
                        hasProperty: samples.hasProperty,
                        instanceOf: samples.instanceOf
                    },
                    {
                        array: {
                            actual: [ 1 ],
                            check: 'array',
                            location: testLocation,
                            message: 'array',
                            source: 'require'
                        },
                        hasProperty: {
                            actual: { name: 'Ada' },
                            check: 'has-property',
                            key: 'name',
                            location: testLocation,
                            message: null,
                            source: 'require'
                        },
                        instanceOf: {
                            actual: samples.instanceOf.actual,
                            check: 'instance-of',
                            expected: Error,
                            location: testLocation,
                            message: null,
                            source: 'require'
                        }
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createRecordingRequireFacade() applies annotated messages',
            metadata: {},
            body(scope: OverkillScope) {
                const recording = createRequireRecording();
                const requiredValue: RequireAssertionFacade = recording.facade.annotated('required value');
                const optionValue: RequireAssertionFacade = recording.facade.annotated('base message');

                requiredValue.string('value');
                optionValue.string('value', { message: 'option value' });

                scope.assert.deepEqual(
                    recording.records.map(function messageOf(record) {
                        return record.message;
                    }),
                    [ 'required value', 'option value' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
