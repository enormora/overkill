import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import * as simulationSubpath from './simulation.entry-point.ts';

function sortedKeys(value: Readonly<Record<string, unknown>>): readonly string[] {
    return Object.keys(value).toSorted(function compareExportNames(left, right) {
        return left.localeCompare(right);
    });
}

const assertSimulationSubpathExports = defineCompositeAssertion({
    name: 'simulation subpath exports',
    assert(check) {
        return check.group([
            check.deepEqual(sortedKeys(simulationSubpath), [
                'defineSimulatedHttpServer',
                'defineSimulation',
                'isDefinedSimulatedHttpServer',
                'isDefinedSimulation'
            ]),
            check.equal(typeof simulationSubpath.defineSimulation, 'function')
        ]);
    }
});

export const testNode = suite('Simulation subpath', [
    test('@overkill-dev/test/simulation re-exports simulation descriptors', function (scope) {
        scope.assert(assertSimulationSubpathExports);

        return scope.assert.collect();
    })
]);
