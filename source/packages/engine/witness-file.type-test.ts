import { test } from '@overkill-dev/test';
import { assignableTo, sameType } from '@overkill-dev/type-test';
import {
    parseWitnessFile,
    type EncodedPropertyInput,
    type PropertyWitnessFile,
    type SimulationWitnessFile,
    type WitnessFile,
    type WitnessHeader,
    type PropertyWitnessTarget
} from './engine.entry-point.ts';

export const testNode = test('witness kinds narrow without casts', function (typeScope) {
    const witness = parseWitnessFile(null);
    typeScope.assert(sameType.withActual<WitnessFile>(), witness);
    typeScope.assert(assignableTo.withActual<WitnessHeader>(), witness);
    if (witness.kind === 'property') {
        typeScope.assert(sameType.withActual<PropertyWitnessFile>(), witness);
        typeScope.assert(sameType.withActual<PropertyWitnessTarget>(), witness.target);
        typeScope.assert(sameType.withActual<EncodedPropertyInput>(), witness.counterexample);
        typeScope.assert(sameType.withActual<string>(), witness.seed);
    } else {
        typeScope.assert(sameType.withActual<SimulationWitnessFile>(), witness);
        typeScope.assert(sameType.withActual<string | null>(), witness.seed);
    }
    return typeScope.assert.collect();
});
