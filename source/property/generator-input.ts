import { Value, type Arbitrary, type Random } from 'fast-check';
import { prepareGenerator, type Generator as PropertyGenerator } from './generator.ts';
import type { GeneratorContext } from './generator-backend.ts';

export type GeneratedInput<Input> = {
    readonly reconstruct: () => Input;
    readonly shrink: () => IterableIterator<GeneratedInput<Input>>;
};

type Generation<Input> = {
    readonly generator: PropertyGenerator<Input>;
    readonly random: Random;
    readonly bias: number | undefined;
    readonly context: GeneratorContext;
};

type RetainedInput<Input> = {
    readonly domain: Arbitrary<Input>;
    readonly value: Value<Input>;
    readonly path: readonly number[];
};

function reconstructInput<Input>(generation: Generation<Input>, path: readonly number[]): Input {
    const { generator, random, bias, context } = generation;
    context.consumeWork();
    const domain = prepareGenerator(generator, context);
    let value = domain.generate(random.clone(), bias);
    for (const ordinal of path) {
        const candidate = domain.shrink(value.value, value.context).drop(ordinal).next();
        if (candidate.done === true) {
            throw new Error('Retained generator path could not be reconstructed.');
        }
        value = candidate.value;
    }
    return value.value;
}

function retainedInput<Input>(generation: Generation<Input>, retained: RetainedInput<Input>): GeneratedInput<Input> {
    return Object.freeze({
        reconstruct() {
            return reconstructInput(generation, retained.path);
        },
        shrink() {
            const { domain, value, path } = retained;
            return (function* candidates() {
                let ordinal = 0;
                for (const candidate of domain.shrink(value.value, value.context)) {
                    yield retainedInput(generation, {
                        domain,
                        value: candidate,
                        path: [ ...path, ordinal ]
                    });
                    ordinal += 1;
                }
            })();
        }
    });
}

export function generateInput<Input>(
    generator: PropertyGenerator<Input>,
    random: Random,
    bias: number | undefined,
    context: GeneratorContext
): GeneratedInput<Input> {
    const generation: Generation<Input> = {
        generator,
        random: random.clone(),
        bias,
        context: Object.freeze({ ...context })
    };
    const domain = prepareGenerator(generator, generation.context);
    return retainedInput(generation, { domain, value: domain.generate(random, bias), path: [] });
}

export function recipeInput<Input>(
    generator: PropertyGenerator<Input>,
    recipe: () => Input,
    context: GeneratorContext
): GeneratedInput<Input> | null {
    const domain = prepareGenerator(generator, context);
    const original = recipe();
    if (!domain.canShrinkWithoutContext(original)) {
        return null;
    }
    function reconstruct(path: readonly number[]): Value<Input> {
        context.consumeWork();
        const fresh = prepareGenerator(generator, context);
        let value = new Value(recipe(), undefined);
        for (const ordinal of path) {
            context.consumeWork();
            const child = fresh.shrink(value.value, value.context).drop(ordinal).next();
            if (child.done === true) {
                throw new Error('Recipe shrink path could not be reconstructed.');
            }
            value = child.value;
        }
        return value;
    }
    function retain(path: readonly number[]): GeneratedInput<Input> {
        return {
            reconstruct() {
                return reconstruct(path).value;
            },
            shrink() {
                return (function* candidates() {
                    const value = reconstruct(path);
                    const children = domain.shrink(value.value, value.context);
                    let ordinal = 0;
                    for (let child = children.next(); child.done !== true; child = children.next()) {
                        context.consumeWork();
                        yield retain([ ...path, ordinal ]);
                        ordinal += 1;
                    }
                })();
            }
        };
    }
    return retain([]);
}
