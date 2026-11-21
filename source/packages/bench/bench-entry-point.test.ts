import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';
import { type EngineCaseBody, createTestEngine } from '../../test-support/create-test-engine.ts';

import { benchmarkAuthoringExports } from '../../test-support/benchmark-authoring-exports.ts';
import {
    createEngine,
    type RunResult,
    type TestPlan,
    createRoot,
    createTestPlan,
    ownsTestNode
} from '../engine/engine.entry-point.ts';

import { suite as subjectSuite, test as subjectTest } from '../test/test.entry-point.ts';
import * as bench from './bench.entry-point.ts';

type PassingBodyAssertions = { readonly assert: Pick<TestScope['assert'], 'collect' | 'true'>; };

function passingBody(
    scope: PassingBodyAssertions
): ReturnType<EngineCaseBody> {
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
                subjectSuite('ordinary suite', [
                    subjectTest('fails', function (testScope) {
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
    const engine = createTestEngine();
    return { plan, result: await engine.execute(plan), rows };
}

const assertMixedMetadata = defineCompositeAssertion({
    name: 'mixed metadata',
    assert(check, plan: TestPlan) {
        const first = plan.discoveredCases[0];
        return check.group([
            check.deepEqual(first.annotations.tags, [ 'suite', 'case' ]),
            check.deepEqual(first.annotations.ownership, [ 'performance' ]),
            check.equal(first.controls.capture, 'buffered'),
            check.equal(first.controls.timeoutMilliseconds, 100)
        ]);
    }
});

const assertMixedOutcomes = defineCompositeAssertion({
    name: 'mixed outcomes',
    assert(check, execution: MixedAuthoringExecution) {
        return check.group([
            check.deepEqual(execution.rows, [ 4, 7 ]),
            check.equal(execution.result.summary.passed, 3),
            check.equal(execution.result.summary.failed, 1),
            check.equal(execution.result.summary.skipped, 1),
            check.deepEqual(execution.result.runnerErrors, []),
            check.deepEqual(
                execution.result.perTest.map(function verdict(entry) {
                    return entry.outcome?.kind;
                }),
                [ 'pass', 'fail', 'pass', 'pass', 'skip' ]
            )
        ]);
    }
});

export const testNode = suite('Bench entry point', [
    test('exposes only the focused authoring surface', function (scope) {
        scope.assert.deepEqual(
            Object.keys(bench).toSorted(function compareNames(left, right) {
                return left.localeCompare(right);
            }),
            benchmarkAuthoringExports
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
        scope.assert(assertMixedMetadata, execution.plan);
        scope.assert(assertMixedOutcomes, execution);
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
