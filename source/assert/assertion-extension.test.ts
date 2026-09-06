import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    isAssertionReference,
    isCompositeAssertionGroup,
    isNarrowingAssertionReference,
    type CompositeAssertionChildNode
} from '../packages/engine/assertion-protocol.entry-point.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import {
    createCompositeCheckBuilder,
    defineCompositeAssertion,
    defineNarrowingCompositeAssertion,
    type CompositeCheckBuilder
} from './assertion-extension.ts';

function builtInChildren(
    check: CompositeCheckBuilder<'assert'>
): readonly CompositeAssertionChildNode<'assert'>[] {
    return [
        check.array([]),
        check.arrayContainsPartial([], {}),
        check.between(2, 1, 3),
        check.boolean(true),
        check.deepEqual({ ok: true }, { ok: true }),
        check.defined('value'),
        check.empty([]),
        check.endsWith('value', 'ue'),
        check.equal(1, 1),
        check.fail(),
        check.false(false),
        check.function(function value() {
            return undefined;
        }),
        check.greaterThan(2, 1),
        check.greaterThanOrEqual(2, 2),
        check.hasProperty({ name: 'Ada' }, 'name'),
        check.includes('value', 'al'),
        check.instanceOf(new Error('boom'), Error),
        check.length([ 1 ], 1),
        check.lessThan(1, 2),
        check.lessThanOrEqual(2, 2),
        check.match('value', /value/u),
        check.membersPartialDeepEqual([ { ok: true } ], [ { ok: true } ]),
        check.notDeepEqual({ ok: true }, { ok: false }),
        check.notEmpty([ 1 ]),
        check.notEqual(1, 2),
        check.notMatch('value', /other/u),
        check.notNull('value'),
        check.null(null),
        check.number(1),
        check.object({}),
        check.partialDeepEqual({ ok: true }, { ok: true }),
        ...check
            .throws(
                function throwExpectedError() {
                    throw new Error('expected');
                },
                { message: 'expected' }
            )
            .children,
        check.startsWith('value', 'va'),
        check.string('value'),
        check.true(true),
        check.undefined(undefined)
    ];
}

function checkNames(children: readonly CompositeAssertionChildNode<'assert'>[]): readonly string[] {
    return children.map(function checkName(child) {
        return child.check;
    });
}

function foreignLocations(
    children: readonly CompositeAssertionChildNode<'assert'>[]
): readonly CompositeAssertionChildNode<'assert'>['location'][] {
    return children.map(function locationOf(child) {
        return child.location;
    });
}

export const testSuite = createOverkillSuite({
    title: 'source/assert/assertion-extension.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'createCompositeCheckBuilder() creates every built-in composite child node',
            metadata: {},
            body(scope: OverkillScope) {
                const check = createCompositeCheckBuilder('assert', 'child', unknownSourceLocation);
                const children = builtInChildren(check);
                const annotated = check.annotated('annotated').true(true);
                const group = check.group([ annotated ]);

                scope.assert.deepEqual(checkNames(children), [
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
                    'instance-of',
                    'equal',
                    'starts-with',
                    'string',
                    'true',
                    'undefined'
                ]);
                scope.assert.deepEqual(
                    {
                        annotatedLocation: annotated.location,
                        annotatedMessage: annotated.message,
                        objectIsCompositeGroup: isCompositeAssertionGroup({}),
                        nullIsCompositeGroup: isCompositeAssertionGroup(null),
                        validIsCompositeGroup: isCompositeAssertionGroup(group)
                    },
                    {
                        annotatedLocation: unknownSourceLocation,
                        annotatedMessage: 'annotated',
                        objectIsCompositeGroup: false,
                        nullIsCompositeGroup: false,
                        validIsCompositeGroup: true
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createCompositeCheckBuilder() flattens composite assertion groups',
            metadata: {},
            body(scope: OverkillScope) {
                const check = createCompositeCheckBuilder('assert', 'child', unknownSourceLocation);
                const group = check.group([
                    check.true(true),
                    check.throws(function throwExpectedError() {
                        throw new Error('expected');
                    }, { message: 'expected' })
                ]);

                scope.assert.deepEqual(checkNames(group.children), [ 'true', 'instance-of', 'equal' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createCompositeCheckBuilder() creates async rejects groups',
            metadata: {},
            async body(scope: OverkillScope) {
                const check = createCompositeCheckBuilder('assert', 'child', unknownSourceLocation);
                const group = await check.rejects(async function rejectExpectedError() {
                    await Promise.reject(new Error('expected'));
                }, { message: 'expected' });

                scope.assert.deepEqual(checkNames(group.children), [ 'instance-of', 'equal' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'composite foreign bridges normalize passing and failing callbacks',
            metadata: {},
            async body(scope: OverkillScope) {
                const location = { column: 5, file: '/test/composite.test.ts', line: 10 };
                const check = createCompositeCheckBuilder('assert', null, location);
                const thrown = check.fromThrowable('throws', function throwForeignError() {
                    throw new TypeError('bad');
                });
                const resolved = await check.fromRejectable('resolves', async function resolveForeignExpectation() {
                    await Promise.resolve();
                });
                const rejected = await check.fromRejectable('rejects', async function rejectForeignExpectation() {
                    await Promise.reject(new RangeError('outside'));
                });

                scope.assert.deepEqual(
                    [ thrown.result.passed, resolved.result.passed, rejected.result.passed ],
                    [ false, true, false ]
                );
                scope.assert.equal(thrown.result.passed ? null : thrown.result.error.name, 'TypeError');
                scope.assert.equal(rejected.result.passed ? null : rejected.result.error.name, 'RangeError');
                scope.assert.deepEqual(
                    foreignLocations([ thrown, resolved, rejected ]),
                    [ location, location, location ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'assertion references expose brand and empty-name validation',
            metadata: {},
            body(scope: OverkillScope) {
                const reference = defineCompositeAssertion({
                    assert(check) {
                        return check.true(true);
                    },
                    name: 'custom'
                });
                const narrowing = defineNarrowingCompositeAssertion({
                    name: 'narrow',
                    narrows(value: unknown): value is string {
                        return typeof value === 'string';
                    }
                });

                scope.assert.equal(isAssertionReference(reference), true);
                scope.assert.equal(isNarrowingAssertionReference(narrowing), true);
                scope.assert.throws(function defineEmptyCompositeAssertion() {
                    defineCompositeAssertion({
                        assert(check) {
                            return check.true(true);
                        },
                        name: ''
                    });
                }, { message: /must not be empty/u });
                scope.assert.throws(function defineEmptyNarrowingAssertion() {
                    defineNarrowingCompositeAssertion({
                        name: '',
                        narrows(value: unknown): value is string {
                            return typeof value === 'string';
                        }
                    });
                }, { message: /must not be empty/u });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
