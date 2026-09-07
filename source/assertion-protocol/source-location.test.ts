import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    captureSourceLocation,
    resolveSourceLocation,
    sourceLocationFromStack,
    unknownSourceLocation
} from './source-location.ts';
import {
    forwardAssertionSourceLocations,
    sourceLocationsWithCurrentForwarding
} from './source-location-forwarding.ts';

export const testSuite = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/assertion-protocol/source-location.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
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
            definitionLocations: [ { column: null, file: '', line: null } ],
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
            definitionLocations: [ { column: null, file: '', line: null } ],
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
            definitionLocations: [ { column: null, file: '', line: null } ],
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
            definitionLocations: [ { column: null, file: '', line: null } ],
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
            definitionLocations: [ { column: null, file: '', line: null } ],
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'assertion source location forwarding preserves nested authoring chains',
            metadata: {},
            body(scope: OverkillScope) {
                const outerLocation = { column: 1, file: 'macro.ts', line: 2 };
                const innerLocation = { column: 3, file: 'body.ts', line: 4 };
                const assertionLocation = { column: 5, file: 'assertion.ts', line: 6 };

                const sourceLocations = forwardAssertionSourceLocations([ outerLocation ], function forwardOuter() {
                    return forwardAssertionSourceLocations([ innerLocation ], function forwardInner() {
                        return sourceLocationsWithCurrentForwarding(function captureAssertion() {
                            return assertionLocation;
                        });
                    });
                });

                scope.assert.deepEqual(sourceLocations, [ outerLocation, innerLocation, assertionLocation ]);
                scope.assert.throws(function forwardWithoutLocations() {
                    forwardAssertionSourceLocations([] as never, function noop() {
                        return null;
                    });
                }, { message: 'Assertion source location forwarding requires at least one location.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);
