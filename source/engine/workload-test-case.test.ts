import { suite, test } from '../packages/test/test.entry-point.ts';
import { workload, type Workload } from '../packages/bench/bench.entry-point.ts';
import type {
    Engine,
    TestBody,
    TestCaseDefinition,
    TestPlan,
    TestScope,
    WorkloadTestCaseVariant
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { caseId, workload as workloadFilter, parseRunFilterExpression } from '../packages/run/filters.entry-point.ts';
import { matchesRunFilter } from '../run/run-selection-filters.ts';
import { selectedAssignedWork } from '../run/worker-pool-worker-plan.ts';
import { workIdentityKey } from './identity.ts';

const metadata: TestCaseDefinition = {
    annotations: { tags: [ 'workload' ] },
    controls: { timeoutMilliseconds: 100 },
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'publish'
};
type WorkloadFixture = {
    readonly engine: Engine;
    readonly observed: readonly number[];
    readonly plan: TestPlan;
};

function passingBody(scope: TestScope): ReturnType<TestBody> {
    scope.assert.true(true);
    return scope.assert.collect();
}

function workloadBody(
    input: Workload<string, { readonly packages: number; }>,
    observe: (value: number) => void
): WorkloadTestCaseVariant {
    return {
        id: input.id,
        body(scope: TestScope) {
            observe(input.parameters.packages);
            scope.assert.greaterThan(input.parameters.packages, 0);
            return scope.assert.collect();
        }
    };
}

function createWorkloadFixture(): WorkloadFixture {
    const engine = createTestEngine();
    const observed: number[] = [];
    const observe = function (value: number): void {
        observed.push(value);
    };
    const child = engine.createWorkloadTestCase({
        ...metadata,
        workloads: [
            workloadBody(workload('small', { packages: 5 }), observe),
            workloadBody(workload('large', { packages: 50 }), observe)
        ]
    });
    const plan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'root',
        children: [ child ]
    }));
    return { engine, observed, plan };
}

export const testNode = suite('workload test cases', [
    test('lowers one logical node into distinct work identities without running bodies', function (scope: TestScope) {
        const { observed, plan } = createWorkloadFixture();
        scope.assert.equal(observed.length, 0);
        scope.assert.equal(plan.defined, 1);
        scope.assert.equal(plan.cases.length, 2);
        return scope.assert.collect();
    }),
    test('preserves logical case identity while expanding workload identity', function (scope: TestScope) {
        const { plan } = createWorkloadFixture();
        const second = plan.cases[1];
        scope.require.defined(second);
        scope.assert.deepEqual(plan.cases[0].id, second.id);
        scope.assert.deepEqual(
            plan.cases.map(function name(entry) {
                return entry.workId.workload?.name;
            }),
            [ 'small', 'large' ]
        );
        const identities = new Set(plan.cases.map(function key(entry) {
            return workIdentityKey(entry.workId);
        }));
        scope.assert.equal(identities.size, 2);
        return scope.assert.collect();
    }),
    test('selects logical cases and resolved workload names', function (scope: TestScope) {
        const { plan } = createWorkloadFixture();
        const second = plan.cases[1];
        scope.require.defined(second);
        scope.assert.true(matchesRunFilter(caseId(plan.cases[0].id), second));
        scope.assert.true(matchesRunFilter(workloadFilter('small'), plan.cases[0]));
        scope.assert.false(matchesRunFilter(workloadFilter('large'), plan.cases[0]));
        scope.assert.true(matchesRunFilter(parseRunFilterExpression('workload:s* !workload=large'), plan.cases[0]));
        scope.assert.true(matchesRunFilter(parseRunFilterExpression('workload~MAL'), plan.cases[0]));
        return scope.assert.collect();
    }),
    test('executes only assigned workload bodies and preserves result identity', async function (scope) {
        const { engine, observed, plan } = createWorkloadFixture();
        const selected = selectedAssignedWork(plan, [ plan.cases[0].workId ], []);
        const result = await engine.execute(selected);
        scope.assert.deepEqual(Array.from(observed), [ 5 ]);
        scope.assert.partialDeepEqual(result, {
            summary: { discovered: 2, planned: 1, passed: 1 },
            perTest: [ { workId: plan.cases[0].workId } ],
            runnerErrors: []
        });
        const complete = await engine.execute(plan);
        scope.assert.deepEqual(observed, [ 5, 5, 50 ]);
        scope.assert.equal(complete.summary.passed, 2);
        scope.assert.deepEqual(complete.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('copies identity data and preserves engine ownership', function (scope) {
        const engine = createTestEngine();
        const id = { name: 'small', params: { count: '5' } };
        const child = engine.createWorkloadTestCase({ ...metadata, workloads: [ { id, body: passingBody } ] });
        id.params.count = '10';
        const plan = engine.createTestPlan(engine.createRoot({
            annotations: {},
            controls: {},
            title: 'root',
            children: [ child ]
        }));
        scope.assert.equal(plan.cases[0].workId.workload?.params.count, '5');
        const otherEngine = createTestEngine();
        scope.assert.false(otherEngine.ownsTestNode(child));
        return scope.assert.collect();
    }),
    test('rejects empty, duplicate, or malformed workloads', function (scope) {
        const engine = createTestEngine();
        const id = { name: 'small', params: { count: '5' } };
        const invalidWorkloads = {
            empty: [],
            missingBody: [ { id, body: null } ],
            blankName: [ { id: { name: ' ', params: {} }, body: passingBody } ],
            numericParameter: [ { id: { name: 'small', params: { count: 5 } }, body: passingBody } ],
            duplicateNames: [
                { id: { name: '\u{E9}', params: {} }, body: passingBody },
                { id: { name: 'e\u{301}', params: {} }, body: passingBody }
            ]
        };
        for (const workloads of Object.values(invalidWorkloads)) {
            scope.assert.throws(function () {
                Reflect.apply(engine.createWorkloadTestCase, undefined, [ { ...metadata, workloads } ]);
            }, { message: /(?:Workload|Duplicate)/v });
        }
        return scope.assert.collect();
    })
]);
