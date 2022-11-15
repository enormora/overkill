import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { compareValues } from './compare-primitives.js';

test('values are considered equal when two empty strings are given', () => {
    const result = compareValues('', '');

    assert.equal(result, { isEqual: true });
});

test('values are considered equal when two strings with the same content are given', () => {
    const result = compareValues('foo', 'foo');

    assert.equal(result, { isEqual: true });
});

test('values are considered NOT equal when two strings with the same content are given but wrapped in an object', () => {
    const result = compareValues(new String('foo'), new String('foo'));

    assert.equal(result, {
        isEqual: false,
        leftHandSide: { value: new String('foo'), detectedType: 'object' },
        rightHandSide: { value: new String('foo'), detectedType: 'object' },
    });
});

test('values are considered equal when both are null', () => {
    const result = compareValues(null, null);

    assert.equal(result, { isEqual: true });
});

test('values are considered equal when both are undefined', () => {
    const result = compareValues(undefined, void 0);

    assert.equal(result, { isEqual: true });
});

test('values are considered NOT equal when one is null and one is undefined', () => {
    const result = compareValues(undefined, null);

    assert.equal(result, {
        isEqual: false,
        leftHandSide: { value: undefined, detectedType: 'undefined' },
        rightHandSide: { value: null, detectedType: 'null' },
    });
});

test('values are considered equal when both are false', () => {
    const result = compareValues(false, false);

    assert.equal(result, { isEqual: true });
});

test('values are considered equal when both are true', () => {
    const result = compareValues(true, true);

    assert.equal(result, { isEqual: true });
});

test('values are considered NOT equal when one is true and one is false', () => {
    const result = compareValues(true, false);

    assert.equal(result, {
        isEqual: false,
        leftHandSide: { value: true, detectedType: 'boolean' },
        rightHandSide: { value: false, detectedType: 'boolean' },
    });
});

test('values are considered equal when both are the same number', () => {
    const result = compareValues(42, 42);

    assert.equal(result, { isEqual: true });
});

test('values are considered equal when both are the same bigint', () => {
    const result = compareValues(42n, 42n);

    assert.equal(result, { isEqual: true });
});

test('values are considered NOT equal when comparing -0 and +0', () => {
    const result = compareValues(-0, 0);

    assert.equal(result, {
        isEqual: false,
        leftHandSide: { value: -0, detectedType: 'number' },
        rightHandSide: { value: 0, detectedType: 'number' },
    });
});

test('values are considered NOT equal when comparing a regular number with a bigint', () => {
    const result = compareValues(42, 42n);

    assert.equal(result, {
        isEqual: false,
        leftHandSide: { value: 42, detectedType: 'number' },
        rightHandSide: { value: 42n, detectedType: 'bigint' },
    });
});

test('values are considered equal when both are NaN', () => {
    const result = compareValues(NaN, NaN);

    assert.equal(result, { isEqual: true });
});

test('values are considered equal when both referring to the same function', () => {
    const fn = () => {};
    const result = compareValues(fn, fn);

    assert.equal(result, { isEqual: true });
});

test('values are considered NOT equal when both referring to a different function', () => {
    const fn1 = () => {};
    const fn2 = () => {};
    const result = compareValues(fn1, fn2);

    assert.equal(result, {
        isEqual: false,
        leftHandSide: { value: fn1, detectedType: 'function' },
        rightHandSide: { value: fn2, detectedType: 'function' },
    });
});

test('values are considered equal when both referring to the same array', () => {
    const list: unknown[] = [];
    const result = compareValues(list, list);

    assert.equal(result, { isEqual: true });
});

test('values are considered NOT equal when both referring to a different array', () => {
    const list1: unknown[] = [];
    const list2: unknown[] = [];
    const result = compareValues(list1, list2);

    assert.equal(result, {
        isEqual: false,
        leftHandSide: { value: list1, detectedType: 'array' },
        rightHandSide: { value: list2, detectedType: 'array' },
    });
});

test('values are considered equal when both referring to the global object', () => {
    const result = compareValues(globalThis, globalThis);

    assert.equal(result, { isEqual: true });
});

test('values are considered equal when both referring to the same object', () => {
    const object = {};
    const result = compareValues(object, object);

    assert.equal(result, { isEqual: true });
});

test('values are considered NOT equal when both referring to a different object', () => {
    const object1 = {};
    const object2 = {};
    const result = compareValues(object1, object2);

    assert.equal(result, {
        isEqual: false,
        leftHandSide: { value: object1, detectedType: 'object' },
        rightHandSide: { value: object2, detectedType: 'object' },
    });
});

test.run();
