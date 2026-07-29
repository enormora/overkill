import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import {
    captureSourceLocation,
    resolveSourceLocation,
    sourceLocationFromStack,
    unknownSourceLocation
} from './source-location.ts';

registerTest('sourceLocationFromStack() parses file URL stack frames', function () {
    assert.deepStrictEqual(
        sourceLocationFromStack(
            [
                'Error',
                '    at captureSourceLocation (file:///workspace/source/assertion-protocol/source-location.ts:42:19)',
                '    at body (file:///workspace/source/users.test.ts:10:5)'
            ]
                .join('\n')
        ),
        {
            column: 5,
            file: '/workspace/source/users.test.ts',
            line: 10
        }
    );
});

registerTest('sourceLocationFromStack() parses plain path stack frames', function () {
    assert.deepStrictEqual(
        sourceLocationFromStack(
            [
                'Error',
                '    at captureSourceLocation (/workspace/source/assertion-protocol/source-location.ts:42:19)',
                '    at body (/workspace/source/users.test.ts:12:7)'
            ]
                .join('\n')
        ),
        {
            column: 7,
            file: '/workspace/source/users.test.ts',
            line: 12
        }
    );
});

registerTest('sourceLocationFromStack() returns the unknown location for unusable stacks', function () {
    assert.deepStrictEqual(
        sourceLocationFromStack(
            [
                'Error',
                '    at captureSourceLocation (file:///workspace/source/assertion-protocol/source-location.ts:42:19)',
                '    at node:internal/test_runner/test:1:1'
            ]
                .join('\n')
        ),
        unknownSourceLocation
    );
});

registerTest('captureSourceLocation() returns a memoized provider for the capture callsite', function () {
    const location = captureSourceLocation();
    const first = location();
    const second = location();

    assert.strictEqual(first, second);
    assert.match(first.file, /source-location\.test\.ts$/u);
    assert.equal(typeof first.line, 'number');
    assert.equal(typeof first.column, 'number');
});

registerTest('resolveSourceLocation() protects failures from provider errors', function () {
    assert.deepStrictEqual(
        resolveSourceLocation(function throwLocationError() {
            throw new Error('location failed');
        }),
        unknownSourceLocation
    );
});
