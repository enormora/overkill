import { suite, test } from '@overkill-dev/test';

import type { TestScope } from '../engine/engine.entry-point.ts';
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

export const testNode = suite('source/packages/test/simulation-subpath.test.ts', [
    test('@overkill-dev/test/simulation re-exports simulation descriptors', function (scope: TestScope) {
        assertSimulationSubpathExports(scope);

        return scope.assert.collect();
    })
]);
