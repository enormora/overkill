import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';

registerTest('createTestPlan() expands suites and tables into executable cases', function () {
    const engine = createEngine();
    const root = engine.createSuite({
        children: [
            engine.createTestCase({
                body(testContext) {
                    testContext.assert.true(true, { message: 'passes' });
                    return testContext.assert.collect();
                },
                metadata: { local: true },
                name: 'first'
            }),
            engine.createTable({
                cases: [
                    {
                        body(testContext) {
                            testContext.assert.true(true, { message: 'row passes' });
                            return testContext.assert.collect();
                        },
                        metadata: { row: 1 },
                        name: 'row 1',
                        parameters: { value: 1 }
                    }
                ],
                metadata: { table: true },
                name: 'rows'
            })
        ],
        metadata: { inherited: true },
        name: 'root'
    });

    const testPlan = engine.createTestPlan(root);

    assert.deepStrictEqual(
        testPlan.cases.map(function toComparableTestCase(testCase) {
            return {
                id: testCase.id,
                metadata: testCase.metadata,
                suitePath: testCase.suitePath
            };
        }),
        [
            {
                id: { file: null, name: 'first', params: null, suite: [ 'root' ] },
                metadata: { inherited: true, local: true },
                suitePath: [ 'root' ]
            },
            {
                id: { file: null, name: 'row 1', params: null, suite: [ 'root', 'rows' ] },
                metadata: { inherited: true, row: 1, table: true },
                suitePath: [ 'root', 'rows' ]
            }
        ]
    );
    assert.deepStrictEqual(testPlan.discoveredCases, testPlan.cases);
    assert.equal(testPlan.defined, 3);
    assert.deepStrictEqual(testPlan.orphans, []);
});

registerTest('createTestPlan() reports constructed nodes that do not reach the root as orphans', function () {
    const engine = createEngine();
    const reached = engine.createTestCase({
        body(testContext) {
            testContext.assert.true(true, { message: 'passes' });
            return testContext.assert.collect();
        },
        metadata: {},
        name: 'reached'
    });
    engine.createTestCase({
        body(testContext) {
            testContext.assert.true(true, { message: 'passes' });
            return testContext.assert.collect();
        },
        metadata: {},
        name: 'unused test'
    });
    engine.createSuite({
        children: [],
        metadata: {},
        name: 'unused suite'
    });
    const root = engine.createSuite({
        children: [ reached ],
        metadata: {},
        name: 'root'
    });

    const testPlan = engine.createTestPlan(root);

    assert.equal(testPlan.defined, 4);
    assert.deepStrictEqual(testPlan.orphans, [
        { file: null, kind: 'test', name: 'unused test' },
        { file: null, kind: 'suite', name: 'unused suite' }
    ]);
});

registerTest('createTestPlan() rejects reachable empty suites', function () {
    const engine = createEngine();
    const root = engine.createSuite({
        children: [],
        metadata: {},
        name: 'root'
    });

    assert.throws(
        function createPlanWithEmptySuite() {
            engine.createTestPlan(root);
        },
        { message: 'Suite must contain at least one child: root.' }
    );
});

registerTest('createTestPlan() rejects reachable empty tables', function () {
    const engine = createEngine();
    const root = engine.createSuite({
        children: [
            engine.createTable({
                cases: [],
                metadata: {},
                name: 'rows'
            })
        ],
        metadata: {},
        name: 'root'
    });

    assert.throws(
        function createPlanWithEmptyTable() {
            engine.createTestPlan(root);
        },
        { message: 'Table must contain at least one case: root > rows.' }
    );
});

registerTest('createTestPlan() rejects duplicate full case identities', function () {
    const engine = createEngine();
    const root = engine.createSuite({
        children: [
            engine.createTestCase({
                body(testContext) {
                    testContext.assert.true(true, { message: 'passes' });
                    return testContext.assert.collect();
                },
                metadata: {},
                name: 'same'
            }),
            engine.createTestCase({
                body(testContext) {
                    testContext.assert.true(true, { message: 'passes' });
                    return testContext.assert.collect();
                },
                metadata: {},
                name: 'same'
            })
        ],
        metadata: {},
        name: 'root'
    });

    assert.throws(
        function createPlanWithDuplicateIds() {
            engine.createTestPlan(root);
        },
        { message: 'Duplicate test case identity: root > same.' }
    );
});

registerTest('createTestPlan() rejects roots from another engine instance', function () {
    const firstEngine = createEngine();
    const secondEngine = createEngine();
    const root = firstEngine.createSuite({
        children: [],
        metadata: {},
        name: 'root'
    });

    assert.throws(
        function createForeignPlan() {
            secondEngine.createTestPlan(root);
        },
        { message: 'Test plan root must be created by the same engine instance.' }
    );
});
