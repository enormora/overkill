import { expect, test } from 'tstyche';
import {
    parseWitnessFile,
    type EncodedPropertyInput,
    type PropertyWitnessFile,
    type SimulationWitnessFile,
    type WitnessFile,
    type WitnessHeader,
    type PropertyWitnessTarget
} from './engine.entry-point.ts';

test('witness kinds narrow without casts', function () {
    const witness = parseWitnessFile(null);
    expect(witness).type.toBe<WitnessFile>();
    expect(witness).type.toBeAssignableTo<WitnessHeader>();
    if (witness.kind === 'property') {
        expect(witness).type.toBe<PropertyWitnessFile>();
        expect(witness.target).type.toBe<PropertyWitnessTarget>();
        expect(witness.counterexample).type.toBe<EncodedPropertyInput>();
        expect(witness.seed).type.toBe<string>();
    } else {
        expect(witness).type.toBe<SimulationWitnessFile>();
        expect(witness.seed).type.toBe<string | null>();
    }
});
