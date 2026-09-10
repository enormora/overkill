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
import type { SourceLocation } from './assertion-node-shape.ts';

function assertCapturedSourceLocation(scope: OverkillScope, location: SourceLocation): void {
    if (location.kind !== 'known') {
        scope.assert.equal(location.kind, 'known');

        return;
    }

    scope.assert.match(location.file, /source-location\.test\.ts$/u);
    scope.assert.equal(typeof location.line, 'number');
    scope.assert.equal(typeof location.column, 'number');
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/assertion-protocol/source-location.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'sourceLocationFromStack() parses file URL stack frames',
            annotations: {},
            controls: {},
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
                        kind: 'known',
                        line: 10
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'sourceLocationFromStack() parses plain path stack frames',
            annotations: {},
            controls: {},
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
                        kind: 'known',
                        line: 12
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'sourceLocationFromStack() returns the unknown location for unusable stacks',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'sourceLocationFromStack() preserves invalid file URL stack frames',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    sourceLocationFromStack('Error\n    at body (file:///%zz/source/users.test.ts:13:8)'),
                    {
                        column: 8,
                        file: 'file:///%zz/source/users.test.ts',
                        kind: 'known',
                        line: 13
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'captureSourceLocation() returns a memoized provider for the capture callsite',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const location = captureSourceLocation();
                const first = location();
                const second = location();

                scope.assert.equal(first, second);
                assertCapturedSourceLocation(scope, first);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'resolveSourceLocation() protects failures from provider errors',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'resolveSourceLocation() rejects invalid known provider results',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function resolveInvalidLocation() {
                    resolveSourceLocation(function invalidKnownLocation() {
                        return { column: null, file: '', kind: 'known' as const, line: null };
                    });
                }, { message: 'Known source location file must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertion source location forwarding preserves nested authoring chains',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const outerLocation = { column: 1, file: 'macro.ts', kind: 'known' as const, line: 2 };
                const innerLocation = { column: 3, file: 'body.ts', kind: 'known' as const, line: 4 };
                const assertionLocation = { column: 5, file: 'assertion.ts', kind: 'known' as const, line: 6 };

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

await runTestFileIfMain(import.meta, testNode);
