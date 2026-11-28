import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
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
    test('types the witness document', function (scope) {
        const witness = parseWitnessFile(null);
        scope.assert(sameType.withActual<true>(), isEqualTo<WitnessFile>()(witness));
        scope.assert(sameType.withActual<true>(), isAssignableTo<WitnessHeader>()(witness));
        return scope.assert.collect();
    }),
    test('narrows property evidence', function (scope) {
        const witness = parseWitnessFile(null);
        if (witness.kind === 'property') {
            scope.assert(sameType.withActual<true>(), isEqualTo<PropertyWitnessFile>()(witness));
            scope.assert(sameType.withActual<true>(), isEqualTo<PropertyWitnessTarget>()(witness.target));
            scope.assert(sameType.withActual<true>(), isEqualTo<EncodedPropertyInput>()(witness.counterexample));
            scope.assert(sameType.withActual<string>(), witness.seed);
        }
        return scope.assert.collect();
    }),
    test('narrows simulation evidence', function (scope) {
        const witness = parseWitnessFile(null);
        if (witness.kind === 'simulation') {
            scope.assert(sameType.withActual<true>(), isEqualTo<SimulationWitnessFile>()(witness));
            scope.assert(sameType.withActual<string | null>(), witness.seed);
        }
        return scope.assert.collect();
    })
]);
