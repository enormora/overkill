import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
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
        metadata: {},
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
        metadata: {},
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
                metadata: {},
                title: 'located suite'
            })
        ],
        metadata: {},
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
        metadata: {},
        title: 'unused suite'
    });

    return engine.createTestPlan(engine.createRoot({
        children: [ reached ],
        metadata: {},
        title: 'root'
    }));
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/test-plan-location.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() preserves supplied definition locations',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const suiteLocation = { column: 5, file: 'source/suite.test.ts', kind: 'known' as const, line: 10 };
                const testLocation = { column: 9, file: 'source/suite.test.ts', kind: 'known' as const, line: 12 };
                const [ testCase ] = createLocatedPlan(engine, suiteLocation, testLocation).cases;

                scope.assert.deepEqual(testCase.definitionLocations, [ testLocation ]);
                scope.assert.deepEqual(testCase.suitePath, [
                    { definitionLocations: [ suiteLocation ], title: 'located suite' }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() reports constructed nodes that do not reach the root as orphans',
            metadata: {},
            body(scope: OverkillScope) {
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
