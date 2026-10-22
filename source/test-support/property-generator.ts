import type { Generator as PropertyGenerator } from '../property/generator.ts';
import { gen } from '../property/generators.ts';

function rejectGeneration(): never {
    throw new Error('Authoring must not invoke generator methods.');
}

export function unexecutedGenerator<Value>(): PropertyGenerator<Value> {
    return gen.constant(null).map<Value>(rejectGeneration);
}
