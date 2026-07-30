import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import type { CompositeAssertionChildNode } from './assertion-node.ts';
import {
    createCompositeCheckBuilder,
    defineCompositeAssertion,
    defineNarrowingCompositeAssertion,
    isAssertionReference,
    isCompositeAssertionGroup,
    isNarrowingAssertionReference,
    type CompositeCheckBuilder
} from './assertion-reference.ts';
import { unknownSourceLocation } from './source-location.ts';

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

function assertForeignLocations(
    children: readonly CompositeAssertionChildNode<'assert'>[],
    location: CompositeAssertionChildNode<'assert'>['location']
): void {
    assert.deepStrictEqual(
        children.map(function locationOf(child) {
            return child.location;
        }),
        children.map(function expectedLocation() {
            return location;
        })
    );
}

registerTest('createCompositeCheckBuilder() creates every built-in composite child node', function () {
    const check = createCompositeCheckBuilder('assert', 'child', unknownSourceLocation);
    const children = builtInChildren(check);
    const annotated = check.annotated('annotated').true(true);
    const group = check.group([ annotated ]);

    assert.deepStrictEqual(checkNames(children), [
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
    assert.equal(annotated.message, 'annotated');
    assert.deepStrictEqual(annotated.location, unknownSourceLocation);
    assert.equal(isCompositeAssertionGroup(group), true);
    assert.equal(isCompositeAssertionGroup({}), false);
    assert.equal(isCompositeAssertionGroup(null), false);
});

registerTest('createCompositeCheckBuilder() flattens composite assertion groups', function () {
    const check = createCompositeCheckBuilder('assert', 'child', unknownSourceLocation);
    const group = check.group([
        check.true(true),
        check.throws(function throwExpectedError() {
            throw new Error('expected');
        }, { message: 'expected' })
    ]);

    assert.deepStrictEqual(checkNames(group.children), [ 'true', 'instance-of', 'equal' ]);
});

registerTest('createCompositeCheckBuilder() creates async rejects groups', async function () {
    const check = createCompositeCheckBuilder('assert', 'child', unknownSourceLocation);
    const group = await check.rejects(async function rejectExpectedError() {
        await Promise.reject(new Error('expected'));
    }, { message: 'expected' });

    assert.deepStrictEqual(checkNames(group.children), [ 'instance-of', 'equal' ]);
});

registerTest('composite foreign bridges normalize passing and failing callbacks', async function () {
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

    assert.deepStrictEqual(
        [ thrown.result.passed, resolved.result.passed, rejected.result.passed ],
        [ false, true, false ]
    );
    assert.equal(thrown.result.passed ? null : thrown.result.error.name, 'TypeError');
    assert.equal(rejected.result.passed ? null : rejected.result.error.name, 'RangeError');
    assertForeignLocations([ thrown, resolved, rejected ], location);
});

registerTest('assertion references expose brand and empty-name validation', function () {
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

    assert.equal(isAssertionReference(reference), true);
    assert.equal(isNarrowingAssertionReference(narrowing), true);
    assert.throws(function defineEmptyCompositeAssertion() {
        defineCompositeAssertion({ assert: reference.assert, name: '' });
    }, /must not be empty/u);
    assert.throws(function defineEmptyNarrowingAssertion() {
        defineNarrowingCompositeAssertion({ name: '', narrows: narrowing.narrows });
    }, /must not be empty/u);
});
