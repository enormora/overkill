import { runIfMain } from '#test-runner';
import { test, suite, table, defineMacro, defineParameterizedTestBody } from '../test/test.entry-point.ts';
import {
    attachTestBodyOrigin,
    captureTestBodyOrigin,
    createEngine,
    forwardTestBodyOrigin,
    readTestBodyOrigin,
    resolveSourceLocation,
    type TestBody
} from '../engine/engine.entry-point.ts';

function parameterizedBody(scope: Parameters<TestBody>[0], value: number): ReturnType<TestBody> {
    scope.assert.equal(value, 1);
    return scope.assert.collect();
}

export const testNode = suite('checker body ownership', [
    test('captures low-level engine callbacks without running them', function (scope) {
        const source: TestBody = function () {
            throw new Error('Do not invoke');
        };
        const node = createEngine().createTestCase({
            title: 'engine case',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body: source
        });
        scope.assert.equal(node.bodyOrigin?.body, source);
        return scope.assert.collect();
    }),
    test('preserves the original callback through macro wrappers without invoking it', function (scope) {
        const source: TestBody = function () {
            throw new Error('Source body must not execute during collection.');
        };
        const declared = defineMacro(function () {
            return test('macro case', source);
        })();
        if (declared.execution.kind !== 'body') {
            throw new Error('Expected a body case.');
        }
        scope.assert.equal(readTestBodyOrigin(declared.execution.body)?.body, source);
        scope.assert.equal(readTestBodyOrigin(source), null);
        return scope.assert.collect();
    }),
    test('preserves shared table callback ownership without invoking rows', function (scope) {
        const source: TestBody = function () {
            throw new Error('Source body must not execute during collection.');
        };
        const rows = table({ title: 'rows', cases: [ 1, 2 ], test: source });
        for (const row of rows.cases) {
            scope.assert.equal(readTestBodyOrigin(row.body)?.body, source);
        }
        scope.assert.equal(readTestBodyOrigin(source), null);
        return scope.assert.collect();
    }),
    test('captures parameterized body declarations before applications', function (scope) {
        const factory = defineParameterizedTestBody(parameterizedBody);
        const first = readTestBodyOrigin(factory(1));
        const second = readTestBodyOrigin(factory(2));
        scope.assert.equal(first, second);
        scope.assert.equal(first?.body, parameterizedBody);
        const location = first === null ? null : resolveSourceLocation(first.location);
        if (location?.kind === 'known') {
            scope.assert.equal(location.file.endsWith('/body-origin.test.ts'), true);
        } else {
            throw new Error('Expected a known body source location.');
        }
        return scope.assert.collect();
    }),
    test('keeps ownership immutable and forwarding idempotent', function (scope) {
        const source: TestBody = function () {
            throw new Error('Do not invoke');
        };
        const other: TestBody = function () {
            throw new Error('Do not invoke');
        };
        const wrapper: TestBody = function () {
            throw new Error('Do not invoke');
        };
        forwardTestBodyOrigin(source, wrapper);
        const origin = readTestBodyOrigin(wrapper);
        forwardTestBodyOrigin(source, wrapper);
        scope.assert.equal(readTestBodyOrigin(wrapper), origin);
        scope.assert.throws(function () {
            return attachTestBodyOrigin(wrapper, captureTestBodyOrigin(other));
        }, {
            message: 'Cannot replace test body source ownership.'
        });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
