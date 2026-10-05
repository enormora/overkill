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
