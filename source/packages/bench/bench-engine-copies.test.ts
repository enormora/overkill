import { extname } from 'node:path';
import {
    createEngine,
    createRoot,
    createTestPlan,
    type Engine,
    type TestBody,
    type TestScope
} from '../engine/engine.entry-point.ts';
import { suite, test } from '../test/test.entry-point.ts';
import { benchmark, wallClockMeasurement, workload } from './bench.entry-point.ts';

type NodeAuthoringEngine = Pick<Engine, 'createRoot' | 'createTestCase' | 'createTestPlan'>;
const nodeAuthoringMethods = [ 'createRoot', 'createTestCase', 'createTestPlan' ];

function isNodeAuthoringEngine(value: unknown): value is NodeAuthoringEngine {
    return typeof value === 'object' && value !== null && nodeAuthoringMethods.every(function (name) {
        return typeof Reflect.get(value, name) === 'function';
    });
}

async function anotherDefaultEngineCopy(): Promise<NodeAuthoringEngine> {
    const location = new URL(import.meta.url);
    const extension = extname(location.pathname);
    const moduleUrl = new URL(`../engine/engine.entry-point${extension}?another-default-copy`, import.meta.url);
    const engine: unknown = await import(moduleUrl.href);

    if (!isNodeAuthoringEngine(engine)) {
        throw new TypeError('Expected an engine authoring module.');
    }

    return engine;
}

function passingBody(scope: TestScope): ReturnType<TestBody> {
    scope.assert.true(true);
    return scope.assert.collect();
}

export const testNode = suite('source/packages/bench/bench-engine-copies.test.ts', [
    test('default engine copies share benchmark ownership and workload planning', async function (scope) {
        const alternate = await anotherDefaultEngineCopy();
        const node = benchmark('owned benchmark', {
            kind: 'runtime',
            workloads: [ workload('one', {}), workload('two', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.measure(function () {
                    return 1;
                });
                return { value: 1 };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 2 } }, two: { value: { maximum: 2 } } }
        });
        const plan = alternate.createTestPlan(
            alternate.createRoot({ title: 'root', children: [ node ], annotations: {}, controls: {} })
        );
        scope.assert.equal(plan.cases.length, 2);
        scope.assert.equal(plan.cases[0].id.title, 'owned benchmark');
        scope.assert.equal(plan.cases[1]?.workId.workload?.name, 'two');
        return scope.assert.collect();
    }),
    test('default engine copies share definition counts and orphan detection', async function (scope) {
        const alternate = await anotherDefaultEngineCopy();
        const baseline = test('baseline', passingBody);
        const root = createRoot({ annotations: {}, children: [ baseline ], controls: {}, title: 'root' });
        const before = createTestPlan(root);
        const child = alternate.createTestCase({
            annotations: {},
            body: passingBody,
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'orphan from another default copy'
        });
        const after = createTestPlan(root);

        scope.assert.equal(after.defined, before.defined + 1);
        scope.assert.true(after.orphans.some(function (orphan) {
            return orphan.title === child.title;
        }));
        scope.assert.equal(createEngine().ownsTestNode(child), false);
        return scope.assert.collect();
    })
]);
