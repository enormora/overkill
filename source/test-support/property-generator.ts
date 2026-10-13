import { generatorBrand, type Generator as PropertyGenerator } from '../property/generator.ts';

function rejectGeneration(): never {
    throw new Error('Authoring must not invoke generator methods.');
}

export function unexecutedGenerator<Value>(): PropertyGenerator<Value> {
    return Object.freeze({
        [generatorBrand]: true,
        map: rejectGeneration,
        flatMap: rejectGeneration,
        filter: rejectGeneration,
        withCodec: rejectGeneration
    });
}
