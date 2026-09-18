import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import * as simulationSubpath from './simulation.entry-point.ts';

function sortedKeys(value: Readonly<Record<string, unknown>>): readonly string[] {
    return Object.keys(value).toSorted(function compareExportNames(left, right) {
        return left.localeCompare(right);
    });
}

function assertSimulationSubpathExports(scope: TestScope): void {
    scope.assert.deepEqual(sortedKeys(simulationSubpath), [
        'defineSimulatedHttpServer',
        'defineSimulation',
        'isDefinedSimulatedHttpServer',
        'isDefinedSimulation'
    ]);
    scope.assert.equal(typeof simulationSubpath.defineSimulation, 'function');
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/simulation-subpath.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/simulation re-exports simulation descriptors',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertSimulationSubpathExports(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
