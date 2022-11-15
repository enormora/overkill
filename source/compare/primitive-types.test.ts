import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { detectType } from './primitive-types.js';

test('returns string when an empty string is given', () => {
    const result = detectType('');

    assert.is(result, 'string');
});

test('returns string when a non-empty string is given', () => {
    const result = detectType('foo');

    assert.is(result, 'string');
});

test('returns string when the String function is used to cast a value', () => {
    const result = detectType(String(42));

    assert.is(result, 'string');
});

test('returns object when the String constructor is used', () => {
    const result = detectType(new String('foo'));

    assert.is(result, 'object');
});

test('returns number when NaN is given', () => {
    const result = detectType(NaN);

    assert.is(result, 'number');
});

test('returns number when a number is given', () => {
    const result = detectType(42);

    assert.is(result, 'number');
});

test('returns number when the Number function is used to cast a value', () => {
    const result = detectType(Number(true));

    assert.is(result, 'number');
});

test('returns object when the Numer constructor is used', () => {
    const result = detectType(new Number(42));

    assert.is(result, 'object');
});

test('returns undefined when undefined is given', () => {
    const result = detectType(undefined);

    assert.is(result, 'undefined');
});

test('returns boolean when true is given', () => {
    const result = detectType(true);

    assert.is(result, 'boolean');
});

test('returns boolean when false is given', () => {
    const result = detectType(false);

    assert.is(result, 'boolean');
});

test('returns boolean when the Boolean function is used to cast a value', () => {
    const result = detectType(Boolean(null));

    assert.is(result, 'boolean');
});

test('returns object when the Boolean constructor is used', () => {
    const result = detectType(new Boolean(null));

    assert.is(result, 'object');
});

test('returns bigint when a bigint value is given', () => {
    const result = detectType(42n);

    assert.is(result, 'bigint');
});

test('returns bigint when casting a value via the BigInt function', () => {
    const result = detectType(BigInt(42));

    assert.is(result, 'bigint');
});

test('returns symbol when a symbol value is given', () => {
    const result = detectType(Symbol());

    assert.is(result, 'symbol');
});

test('returns array when an array created by literal is given', () => {
    const result = detectType([]);

    assert.is(result, 'array');
});

test('returns array when an array created by constructor is given', () => {
    const result = detectType(new Array(5));

    assert.is(result, 'array');
});

test('returns custom-array when an array created by subclassed array constructor is given', () => {
    class Foo extends Array {}
    const result = detectType(new Foo(5));

    assert.is(result, 'custom-array');
});

test('returns function when a function is given', () => {
    const result = detectType(function foo() {});

    assert.is(result, 'function');
});

test('returns global-object when the global object is given', () => {
    const result = detectType(globalThis);

    assert.is(result, 'global-object');
});

test('returns null when null is given', () => {
    const result = detectType(null);

    assert.is(result, 'null');
});

test('returns object when a plain object is given', () => {
    const result = detectType({});

    assert.is(result, 'object');
});

test('returns object when an object with length attribute is given', () => {
    const result = detectType({ length: 5 });

    assert.is(result, 'object');
});

test('returns set when a Set instance is given', () => {
    const result = detectType(new Set([]));

    assert.is(result, 'set');
});

test('returns custom-set when a set created by subclassed Set constructor is given', () => {
    class Foo extends Set {}
    const result = detectType(new Foo([]));

    assert.is(result, 'custom-set');
});

test('returns weak-set when a WeakSet instance is given', () => {
    const result = detectType(new WeakSet([]));

    assert.is(result, 'weak-set');
});

test('returns custom-weak-set when a set created by subclassed WeakSet constructor is given', () => {
    class Foo extends WeakSet {}
    const result = detectType(new Foo([]));

    assert.is(result, 'custom-weak-set');
});

test('returns map when a Map instance is given', () => {
    const result = detectType(new Map([]));

    assert.is(result, 'map');
});

test('returns custom-map when a set created by subclassed Map constructor is given', () => {
    class Foo extends Map {}
    const result = detectType(new Foo());

    assert.is(result, 'custom-map');
});

test('returns weak-map when a WeakMap instance is given', () => {
    const result = detectType(new WeakMap([]));

    assert.is(result, 'weak-map');
});

test('returns custom-weak-map when a set created by subclassed WeakMap constructor is given', () => {
    class Foo extends WeakMap {}
    const result = detectType(new Foo([]));

    assert.is(result, 'custom-weak-map');
});

test('returns promise when a Promise instance is given', () => {
    const result = detectType(Promise.resolve());

    assert.is(result, 'promise');
});

test('returns promise when a subclassed Promise instance is given', () => {
    class Foo extends Promise<unknown> {}
    const result = detectType(new Foo(() => {}));

    assert.is(result, 'promise');
});

test.run();
