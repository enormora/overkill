import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import { isEqualTo, isAssignableTo } from '../../test-support/type-relations.ts';
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
        typeScope.assert(sameType.withActual<true>(), isEqualTo<WitnessFile>()(witness));
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<WitnessHeader>()(witness));
        return typeScope.assert.collect();
    }),
    test('narrows property evidence', function (typeScope) {
        const witness = parseWitnessFile(null);
        if (witness.kind === 'property') {
            typeScope.assert(sameType.withActual<true>(), isEqualTo<PropertyWitnessFile>()(witness));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<PropertyWitnessTarget>()(witness.target));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<EncodedPropertyInput>()(witness.counterexample));
            typeScope.assert(sameType.withActual<string>(), witness.seed);
        }
        return typeScope.assert.collect();
    }),
    test('narrows simulation evidence', function (typeScope) {
        const witness = parseWitnessFile(null);
        if (witness.kind === 'simulation') {
            typeScope.assert(sameType.withActual<true>(), isEqualTo<SimulationWitnessFile>()(witness));
            typeScope.assert(sameType.withActual<string | null>(), witness.seed);
        }
        return typeScope.assert.collect();
    })
]);
