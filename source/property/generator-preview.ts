import { z } from 'zod';
import { ensureGenerator, type Generator as PropertyGenerator } from './generator.ts';
import { generateInput } from './generator-input.ts';
import { generatorPreviewRandom } from './property-random.ts';
import { createPropertyWork, propertyExhaustion } from './property-work.ts';

export type GeneratorSampleRequest = {
    readonly seed: bigint;
    readonly count: number;
    readonly size: number;
    readonly depth: number;
};

const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const requestSchema = z.strictObject({
    seed: z.bigint(),
    count: nonnegativeInteger,
    size: nonnegativeInteger,
    depth: nonnegativeInteger
});

function previewValues<Value>(
    generator: PropertyGenerator<Value>,
    request: GeneratorSampleRequest
): readonly Value[] {
    const { seed, count, size, depth } = request;
    const controller = new AbortController();
    const work = createPropertyWork(
        { maxSize: size, maxDepth: depth, maxWork: 10_000, maxShrinkWork: 0 },
        controller.signal
    );
    const random = generatorPreviewRandom(seed);
    const values: Value[] = [];
    for (let index = 0; index < count; index += 1) {
        work.context.consumeWork();
        values.push(generateInput(generator, random, undefined, work.context).reconstruct());
    }
    return Object.freeze(values);
}

export function sampleGenerator<Value>(
    generator: PropertyGenerator<Value>,
    request: GeneratorSampleRequest
): readonly Value[] {
    ensureGenerator(generator);
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) {
        throw new RangeError(
            'Generator preview requires a bigint seed and nonnegative safe-integer count, size, and depth.'
        );
    }
    try {
        return previewValues(generator, parsed.data);
    } catch (error) {
        const exhaustion = propertyExhaustion(error);
        if (exhaustion !== null) {
            throw new RangeError(`Generator preview could not complete: ${exhaustion}.`, { cause: error });
        }
        throw error;
    }
}
