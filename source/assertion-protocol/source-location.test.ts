import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    captureSourceLocation,
    resolveSourceLocation,
    sourceLocationFromStack,
    unknownSourceLocation
} from './source-location.ts';

export const testSuite = createOverkillSuite({
    title: 'source/assertion-protocol/source-location.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'sourceLocationFromStack() parses file URL stack frames',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'sourceLocationFromStack() parses plain path stack frames',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'sourceLocationFromStack() returns the unknown location for unusable stacks',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'sourceLocationFromStack() preserves invalid file URL stack frames',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    sourceLocationFromStack('Error\n    at body (file:///%zz/source/users.test.ts:13:8)'),
                    {
                        column: 8,
                        file: 'file:///%zz/source/users.test.ts',
                        line: 13
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'captureSourceLocation() returns a memoized provider for the capture callsite',
            metadata: {},
            body(scope: OverkillScope) {
                const location = captureSourceLocation();
                const first = location();
                const second = location();

                scope.assert.equal(first, second);
                scope.assert.match(first.file, /source-location\.test\.ts$/u);
                scope.assert.equal(typeof first.line, 'number');
                scope.assert.equal(typeof first.column, 'number');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'resolveSourceLocation() protects failures from provider errors',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    resolveSourceLocation(function throwLocationError() {
                        throw new Error('location failed');
                    }),
                    unknownSourceLocation
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
