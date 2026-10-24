import { Random, type Arbitrary, type Value } from 'fast-check';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import type { Generator as PropertyGenerator } from '../property/generator.ts';
import type { GeneratorContext } from '../property/generator-backend.ts';
import { generateInput } from '../property/generator-input.ts';

const defaultGeneratorSeed = 42;

export function generatorContext(maxSize: number, maxDepth: number, maxWork: number): GeneratorContext {
    let remaining = maxWork;
    return {
        maxSize,
        maxDepth,
        consumeWork() {
            if (remaining === 0) {
                throw new Error('Generator work exhausted.');
            }
            remaining -= 1;
        },
        exhaustDomain() {
            throw new Error('Generator domain exhausted.');
        }
    };
}

export function generatedValues<Input>(
    generator: PropertyGenerator<Input>,
    count: number,
    context: GeneratorContext
): Input[] {
    const random = new Random(xoroshiro128plus(defaultGeneratorSeed));
    return Array.from({ length: count }, function generateValue() {
        return generateInput(generator, random, undefined, context).reconstruct();
    });
}

export function generatedCandidate<Input>(domain: Arbitrary<Input>, seed: number): Value<Input> {
    return domain.generate(new Random(xoroshiro128plus(seed)), undefined);
}

export function shrinkDescendants<Candidate>(
    root: Candidate,
    count: number,
    children: (parent: Candidate) => Iterable<Candidate>
): Candidate[] {
    const candidates = [ root ];
    for (let index = 0; index < candidates.length && candidates.length <= count; index += 1) {
        const parent = candidates[index];
        if (parent === undefined) {
            throw new Error('Missing shrink parent.');
        }
        const descendants = Iterator.from(children(parent)).take(count + 1 - candidates.length);
        for (const child of descendants) {
            candidates.push(child);
        }
    }
    return candidates.slice(1);
}

export function shrinkCandidates<Input>(domain: Arbitrary<Input>, root: Value<Input>, count: number): Value<Input>[] {
    return shrinkDescendants(root, count, function children(parent) {
        return domain.shrink(parent.value, parent.context);
    });
}
