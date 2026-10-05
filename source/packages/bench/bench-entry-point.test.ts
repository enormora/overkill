import {
    createEngine,
    createRoot,
    createTestPlan,
    execute,
    ownsTestNode,
    type RunResult,
    type TestBody,
    type TestPlan,
    type TestScope
} from '../engine/engine.entry-point.ts';
import { suite, test } from '../test/test.entry-point.ts';
import * as bench from './bench.entry-point.ts';

function passingBody(scope: TestScope): ReturnType<TestBody> {
    scope.assert.true(true);
    return scope.assert.collect();
}

type MixedAuthoringExecution = {
    readonly plan: TestPlan;
    readonly result: RunResult;
    readonly rows: readonly number[];
};

async function executeMixedTree(): Promise<MixedAuthoringExecution> {
    const rows: number[] = [];
    const bodyForValue = bench.defineParameterizedTestBody<number>(function (testScope, value) {
        testScope.assert.equal(value, 3);
        return testScope.assert.collect();
    });
    const child = bench.test({
        annotations: { tags: [ 'case' ], ownership: [ 'performance' ] },
        body: bodyForValue(3),
        controls: { capture: 'buffered', timeoutMilliseconds: 100 },
        title: 'parameterized'
    });
    const plan = createTestPlan(createRoot({
        annotations: {},
        children: [ bench.suite({
            annotations: { tags: [ 'suite' ] },
            children: [
                child,
                suite('ordinary suite', [
                    test('fails', function (testScope) {
                        testScope.assert.equal(1, 2);
                        return testScope.assert.collect();
                    })
                ]),
                bench.table({
                    cases: [ 4, 7 ],
                    caseTitle(value) {
                        return `value ${value}`;
                    },
                    test(testScope) {
                        rows.push(testScope.parameters);
                        testScope.assert.greaterThan(testScope.parameters, 0);
                        return testScope.assert.collect();
                    },
                    title: 'values'
                }),
                bench.skippedTest('not supported', ' platform unavailable ')
            ],
            title: 'bench suite'
        }) ],
        controls: {},
        title: 'root'
    }));
    return { plan, result: await execute(plan), rows };
}

function assertMixedMetadata(scope: TestScope, plan: TestPlan): void {
    const first = plan.discoveredCases[0];
    scope.assert.deepEqual(first.annotations.tags, [ 'suite', 'case' ]);
    scope.assert.deepEqual(first.annotations.ownership, [ 'performance' ]);
    scope.assert.equal(first.controls.capture, 'buffered');
    scope.assert.equal(first.controls.timeoutMilliseconds, 100);
}

function assertMixedOutcomes(scope: TestScope, execution: MixedAuthoringExecution): void {
    scope.assert.deepEqual(execution.rows, [ 4, 7 ]);
    scope.assert.equal(execution.result.summary.passed, 3);
    scope.assert.equal(execution.result.summary.failed, 1);
    scope.assert.equal(execution.result.summary.skipped, 1);
    scope.assert.equal(execution.result.runnerErrors.length, 0);
    scope.assert.deepEqual(
        execution.result.perTest.map(function verdict(entry) {
            return entry.outcome?.kind;
        }),
        [ 'pass', 'fail', 'pass', 'pass', 'skip' ]
    );
}

export const testNode = suite('source/packages/bench/bench-entry-point.test.ts', [
    test('exposes only the focused authoring surface', function (scope) {
        scope.assert.deepEqual(
            Object.keys(bench).toSorted(function compareNames(left, right) {
                return left.localeCompare(right);
            }),
            [
                'defineMacro',
                'defineParameterizedTestBody',
                'skippedTest',
                'suite',
                'table',
                'test'
            ]
        );
        return scope.assert.collect();
    }),
    test('constructs neutral nodes without executing bodies', function (scope) {
        let calls = 0;
        const child = bench.test('deferred body', async function (testScope) {
            calls += 1;
            return passingBody(testScope);
        });
        const plan = createTestPlan(createRoot({
            annotations: {},
            children: [ bench.suite('bench suite', [ child ]) ],
            controls: {},
            title: 'root'
        }));

        scope.assert.equal(calls, 0);
        scope.assert.equal(ownsTestNode(child), true);
        scope.assert.equal(plan.discoveredCases[0].testFamily, null);
        return scope.assert.collect();
    }),
    test('executes mixed suites with tables, controls, annotations, and skips', async function (scope) {
        const execution = await executeMixedTree();
        assertMixedMetadata(scope, execution.plan);
        assertMixedOutcomes(scope, execution);
        return scope.assert.collect();
    }),
    test('preserves validation errors for malformed authoring', function (scope) {
        scope.assert.throws(function () {
            return bench.test('', passingBody);
        }, {
            message: 'Test node title must not be empty.'
        });
        scope.assert.throws(function () {
            Reflect.apply(bench.test, undefined, [ 'invalid', 42 ]);
        }, {
            message: 'Test case body must be a function.'
        });
        scope.assert.throws(function () {
            return bench.skippedTest('invalid', ' ');
        }, {
            message: 'Skipped test reason must not be empty.'
        });
        scope.assert.throws(function () {
            Reflect.apply(bench.suite, undefined, [ 'invalid', [ {} ] ]);
        }, {
            message: 'Suite children must be engine-created TestNode values.'
        });
        return scope.assert.collect();
    }),
    test('uses ordinary defaults for object-form tests and suites', function (scope) {
        const child = bench.test({ body: passingBody, title: 'object form' });
        const plan = createTestPlan(createRoot({
            annotations: {},
            children: [ bench.suite({ children: [ child ], title: 'object suite' }) ],
            controls: {},
            title: 'root'
        }));

        scope.assert.deepEqual(plan.discoveredCases[0].annotations, { ownership: [], tags: [] });
        scope.assert.deepEqual(plan.discoveredCases[0].controls, {
            capture: null,
            duplicateExecution: null,
            timeoutMilliseconds: null
        });
        return scope.assert.collect();
    }),
    test('rejects malformed children and non-function reuse factories', function (scope) {
        scope.assert.throws(function () {
            Reflect.apply(bench.suite, undefined, [ { children: null, title: 'invalid' } ]);
        }, { message: 'suite() requires (title, children) or ({ title, annotations?, controls?, children }).' });
        scope.assert.throws(function () {
            Reflect.apply(bench.defineMacro, undefined, [ null ]);
        }, { message: 'defineMacro() requires a factory function.' });
        scope.assert.throws(function () {
            Reflect.apply(bench.defineParameterizedTestBody, undefined, [ null ]);
        }, { message: 'defineParameterizedTestBody() requires a body function.' });
        return scope.assert.collect();
    }),
    test('rejects macro nodes from another engine instance', function (scope) {
        const foreign = createEngine().createTestCase({
            annotations: {},
            body: passingBody,
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'foreign node'
        });
        const macro = bench.defineMacro(function foreignNode() {
            return foreign;
        });

        scope.assert.throws(function () {
            macro();
        }, { message: 'defineMacro() factory must return a default-engine TestNode value.' });
        return scope.assert.collect();
    })
]);
