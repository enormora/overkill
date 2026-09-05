import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { Engine } from './engine.ts';
import type { TestCaseOptions } from './test-node.ts';

type TestCase = ReturnType<Engine['createTestCase']>;
type SourceLocation = NonNullable<TestCaseOptions['definitionLocation']>;

function createPassingCase(engine: Engine, title: string): TestCase {
    return engine.createTestCase({
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
        body(testScope) {
            testScope.assert.true(true);
            return testScope.assert.collect();
        },
        definitionLocation,
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
                definitionLocation: suiteLocation,
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
        definitionLocation: unusedSuiteLocation,
        metadata: {},
        title: 'unused suite'
    });

    return engine.createTestPlan(engine.createRoot({
        children: [ reached ],
        metadata: {},
        title: 'root'
    }));
}

export const testSuite = createOverkillSuite({
    title: 'source/engine/test-plan-location.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'createTestPlan() preserves supplied definition locations',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const suiteLocation = { column: 5, file: 'source/suite.test.ts', line: 10 };
                const testLocation = { column: 9, file: 'source/suite.test.ts', line: 12 };
                const [ testCase ] = createLocatedPlan(engine, suiteLocation, testLocation).cases;

                scope.assert.deepEqual(testCase.definitionLocation, testLocation);
                scope.assert.deepEqual(testCase.suiteDefinitionLocations, [ suiteLocation ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createTestPlan() reports constructed nodes that do not reach the root as orphans',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const unusedSuiteLocation = { column: 3, file: 'source/orphan.test.ts', line: 7 };
                const unusedTestLocation = { column: 3, file: 'source/orphan.test.ts', line: 3 };
                const testPlan = createPlanWithOrphans(engine, unusedTestLocation, unusedSuiteLocation);

                scope.assert.equal(testPlan.defined, 3);
                scope.assert.deepEqual(testPlan.orphans, [
                    { definitionLocation: unusedTestLocation, file: null, kind: 'test', title: 'unused test' },
                    { definitionLocation: unusedSuiteLocation, file: null, kind: 'suite', title: 'unused suite' }
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
