import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import {
    attachTestBodyFamily,
    attachTestBodyOrigin,
    captureTestBodyOrigin,
    forwardTestBodyOrigin,
    readTestBodyOrigin,
    resolveSourceLocation
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { Engine } from './engine.ts';
import type { DefinitionLocations } from './test-node.ts';

type TestCase = ReturnType<Engine['createTestCase']>;
type SourceLocation = DefinitionLocations[number];

function createPassingCase(engine: Engine, title: string): TestCase {
    return engine.createTestCase({
        definitionLocations: [ { kind: 'unknown' as const } ],
        body(testScope) {
            testScope.assert.true(true, { message: 'passes' });
            return testScope.assert.collect();
        },
        annotations: {},
        controls: {},
        title
    });
}

function createLocatedPassingCase(engine: Engine, title: string, definitionLocation: SourceLocation): TestCase {
    return engine.createTestCase({
        definitionLocations: [ definitionLocation ],
        body(testScope) {
            testScope.assert.true(true);
            return testScope.assert.collect();
        },
        annotations: {},
        controls: {},
        title
    });
}

function createLocatedPlan(
    engine: Engine,
    suiteLocation: SourceLocation,
    testLocation: SourceLocation
): ReturnType<Engine['createTestPlan']> {
    return engine.createTestPlan(engine.createRoot({
        children: [
            engine.createSuite({
                children: [ createLocatedPassingCase(engine, 'located test', testLocation) ],
                definitionLocations: [ suiteLocation ],
                annotations: {},
                controls: {},
                title: 'located suite'
            })
        ],
        annotations: {},
        controls: {},
        title: 'root'
    }));
}

function createPlanWithOrphans(
    engine: Engine,
    unusedTestLocation: SourceLocation,
    unusedSuiteLocation: SourceLocation
): ReturnType<Engine['createTestPlan']> {
    const reached = createPassingCase(engine, 'reached');
    createLocatedPassingCase(engine, 'unused test', unusedTestLocation);
    engine.createSuite({
        children: [],
        definitionLocations: [ unusedSuiteLocation ],
        annotations: {},
        controls: {},
        title: 'unused suite'
    });

    return engine.createTestPlan(engine.createRoot({
        children: [ reached ],
        annotations: {},
        controls: {},
        title: 'root'
    }));
}

export const testNode = suite('source/engine/test-plan-location.test.ts', [
    test('createTestPlan() preserves supplied definition locations', function (scope: OverkillScope) {
        const engine = createEngine();
        const suiteLocation = { column: 5, file: 'source/suite.test.ts', kind: 'known' as const, line: 10 };
        const testLocation = { column: 9, file: 'source/suite.test.ts', kind: 'known' as const, line: 12 };
        const [ testCase ] = createLocatedPlan(engine, suiteLocation, testLocation).cases;

        scope.assert.deepEqual(testCase.definitionLocations, [ testLocation ]);
        scope.assert.deepEqual(testCase.suitePath, [
            { definitionLocations: [ suiteLocation ], title: 'located suite' }
        ]);

        return scope.assert.collect();
    }),
    test(
        'createTestPlan() reports constructed nodes that do not reach the root as orphans',
        function (scope: OverkillScope) {
            const engine = createEngine();
            const unusedSuiteLocation = {
                column: 3,
                file: 'source/orphan.test.ts',
                kind: 'known' as const,
                line: 7
            };
            const unusedTestLocation = {
                column: 3,
                file: 'source/orphan.test.ts',
                kind: 'known' as const,
                line: 3
            };
            const testPlan = createPlanWithOrphans(engine, unusedTestLocation, unusedSuiteLocation);

            scope.assert.equal(testPlan.defined, 3);
            scope.assert.deepEqual(testPlan.orphans, [
                { definitionLocations: [ unusedTestLocation ], file: null, kind: 'test', title: 'unused test' },
                { definitionLocations: [ unusedSuiteLocation ], file: null, kind: 'suite', title: 'unused suite' }
            ]);

            return scope.assert.collect();
        }
    ),
    test('preserves ownership when the same origin is attached again', function (scope: OverkillScope) {
        const body = function (): null {
            return null;
        };
        const origin = captureTestBodyOrigin(body);
        attachTestBodyOrigin(body, origin);

        scope.assert.equal(attachTestBodyOrigin(body, origin), body);
        scope.assert.equal(readTestBodyOrigin(body), origin);
        scope.assert.equal(captureTestBodyOrigin(body), origin);
        return scope.assert.collect();
    }),
    test('rejects replacing the authored body or source location', function (scope: OverkillScope) {
        const body = function (): null {
            return null;
        };
        const origin = captureTestBodyOrigin(body);
        attachTestBodyOrigin(body, origin);

        scope.assert.throws(function replaceBody() {
            attachTestBodyOrigin(body, {
                body() {
                    return null;
                },
                location: origin.location
            });
        }, { message: 'Cannot replace test body source ownership.' });
        scope.assert.throws(function replaceLocation() {
            attachTestBodyOrigin(body, { body, location: { kind: 'unknown' } });
        }, { message: 'Cannot replace test body source ownership.' });
        scope.assert.equal(readTestBodyOrigin(body), origin);
        return scope.assert.collect();
    }),
    test('leaves ownership unchanged when forwarding to itself or from a nonfunction', function (scope: OverkillScope) {
        const body = function (): null {
            return null;
        };
        const origin = captureTestBodyOrigin(body);
        attachTestBodyOrigin(body, origin);
        const unowned = function (): null {
            return null;
        };

        scope.assert.equal(forwardTestBodyOrigin(body, body), body);
        scope.assert.equal(readTestBodyOrigin(body), origin);
        scope.assert.equal(forwardTestBodyOrigin(null, unowned), unowned);
        scope.assert.equal(readTestBodyOrigin(unowned), null);
        return scope.assert.collect();
    }),
    test('rejects a property body carrying a conflicting test family', function (scope: OverkillScope) {
        const engine = createEngine();
        const body = attachTestBodyFamily(function (sample: OverkillScope) {
            sample.assert.true(true);
            return sample.assert.collect();
        }, { family: 'microtest', definition: null });

        scope.assert.throws(function planConflictingFamily() {
            const node = engine.createPropertyTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: 'conflicting property',
                body,
                definition: { kind: 'nested', settingsDeclarations: [ { kind: 'profile-default' } ] }
            });
            engine.createTestPlan(engine.createRoot({
                annotations: {},
                controls: {},
                title: 'family validation',
                children: [ node ]
            }));
        }, { message: 'Test body family "microtest" conflicts with test family "property".' });
        return scope.assert.collect();
    }),
    test('uses the table definition location when a row has no body origin', function (scope: OverkillScope) {
        const engine = createEngine();
        const location = { kind: 'known' as const, file: 'source/table.test.ts', line: 10, column: 1 };
        const table = engine.createTable({
            annotations: {},
            controls: {},
            definitionLocations: [ location ],
            title: 'unowned rows',
            cases: [ 'first', 'second' ].map(function (title) {
                return {
                    annotations: {},
                    controls: {},
                    title,
                    parameters: title,
                    body(sample: OverkillScope) {
                        sample.assert.true(true);
                        return sample.assert.collect();
                    }
                };
            })
        });
        const plan = engine.createTestPlan(engine.createRoot({
            annotations: {},
            controls: {},
            title: 'table fallback',
            children: [ { ...table, bodyOrigins: [] } ]
        }));
        scope.assert.equal(plan.cases.length, 2);
        for (const row of plan.cases) {
            scope.require.notNull(row.bodyOrigin);
            scope.assert.deepEqual(resolveSourceLocation(row.bodyOrigin.location), location);
        }
        return scope.assert.collect();
    })
]);
