import { suite, test } from '@overkill-dev/test-type-authoring';
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

export const testNode = suite('witness kinds narrow without casts', [
    test('types the witness document', function (typeScope) {
        const witness = parseWitnessFile(null);
        typeScope.assert(sameType.withActual<WitnessFile>(), witness);
        typeScope.assert(assignableTo.withActual<WitnessHeader>(), witness);
        return typeScope.assert.collect();
    }),
    test('narrows property evidence', function (typeScope) {
        const witness = parseWitnessFile(null);
        if (witness.kind === 'property') {
            typeScope.assert(sameType.withActual<PropertyWitnessFile>(), witness);
            typeScope.assert(sameType.withActual<PropertyWitnessTarget>(), witness.target);
            typeScope.assert(sameType.withActual<EncodedPropertyInput>(), witness.counterexample);
            typeScope.assert(sameType.withActual<string>(), witness.seed);
        }
        return typeScope.assert.collect();
    }),
    test('narrows simulation evidence', function (typeScope) {
        const witness = parseWitnessFile(null);
        if (witness.kind === 'simulation') {
            typeScope.assert(sameType.withActual<SimulationWitnessFile>(), witness);
            typeScope.assert(sameType.withActual<string | null>(), witness.seed);
        }
        return typeScope.assert.collect();
    })
]);
