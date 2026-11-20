import { type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

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

export const testNode: TestNode = suite('Simulation subpath', [
    test('@overkill-dev/test/simulation re-exports simulation descriptors', function (scope) {
        assertSimulationSubpathExports(scope);

        return scope.assert.collect();
    })
]);
