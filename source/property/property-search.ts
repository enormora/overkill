import { Random } from 'fast-check';
import { xoroshiro128plusFromState } from 'pure-rand/generator/xoroshiro128plus';
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';
import type { PropertyExecutionHost } from '../packages/engine/engine.entry-point.ts';
import { propertyRandom } from './property-random.ts';
import { generateInput, type GeneratedInput } from './generator-input.ts';
import type { GeneratorContext } from './generator-backend.ts';
import type { Generator as PropertyGenerator } from './generator.ts';

const binaryRadix = 2;
const wordBits = 32;
const signBoundary = binaryRadix ** (wordBits - 1);
const wordRange = binaryRadix ** wordBits;
const mutationModes = 2;
const fallbackJump = 42;
type Choices = { readonly words: readonly number[]; readonly state: readonly number[]; };
type Candidate<Value> = { readonly input: GeneratedInput<Value>; readonly choices: Choices; };
type Champion<Value> = { readonly candidate: Candidate<Value>; readonly score: number; };
type ChoiceSource = { readonly source: RandomGenerator; readonly words: readonly number[]; readonly cursor: number; };
type RecordedSource = RandomGenerator & { readonly jump: () => void; };
export type PropertySearch<Value> = {
    readonly next: () => Candidate<Value>;
    readonly accept: (candidate: Candidate<Value>, scores: ReadonlyMap<string, number>) => void;
};

function recordedSource(
    choices: ChoiceSource,
    observe: (index: number, word: number) => void,
    context: GeneratorContext
): RecordedSource {
    const state = choices.source.clone();
    let position = choices.cursor;
    const result: RecordedSource = {
        clone() {
            return recordedSource({ ...choices, source: state, cursor: position }, observe, context);
        },
        next() {
            context.consumeWork();
            const fallback = state.next();
            const value = choices.words[position] ?? fallback;
            observe(position, value);
            position += 1;
            return value;
        },
        jump() {
            for (let index = 0; index < fallbackJump; index += 1) {
                result.next();
            }
        },
        getState() {
            return state.getState();
        }
    };
    return result;
}

function flipWord(word: number, bit: number): number {
    const unsigned = word < 0 ? word + wordRange : word;
    const place = binaryRadix ** bit;
    const changed = unsigned + (Math.floor(unsigned / place) % mutationModes === 0 ? place : -place);
    return changed >= signBoundary ? changed - wordRange : changed;
}

function mutateChoices(choices: Choices, random: Random, ordinal: number, context: GeneratorContext): Choices {
    const index = random.nextInt(0, choices.words.length - 1);
    const words = choices.words.map(function mutate(word, position) {
        context.consumeWork();
        if (position !== index) {
            return word;
        }
        return ordinal % mutationModes === 0
            ? flipWord(word, random.nextInt(0, wordBits - 1))
            : random.nextInt(-signBoundary, signBoundary - 1);
    });
    return { state: choices.state, words };
}

type ChampionArchive<Value> = {
    readonly values: () => MapIterator<Champion<Value>>;
    readonly retain: (label: string, champion: Champion<Value>) => void;
};

function championArchive<Value>(maximum: number): ChampionArchive<Value> {
    const champions = new Map<string, Champion<Value>>();
    return {
        values() {
            return champions.values();
        },
        retain(label, champion) {
            const previous = champions.get(label);
            if (previous !== undefined && previous.score >= champion.score) {
                return;
            }
            if (previous === undefined && champions.size === maximum) {
                const oldest = champions.keys().next();
                if (oldest.done !== true) {
                    champions.delete(oldest.value);
                }
            }
            champions.set(label, champion);
        }
    };
}

export function propertySearch<Value>(
    generator: PropertyGenerator<Value>,
    random: Random,
    context: GeneratorContext,
    maximum: number
): PropertySearch<Value> {
    const champions = championArchive<Value>(maximum);
    let ordinal = 0;
    let guidedOrdinal = 0;
    function fromChoices(choices: Choices): Candidate<Value> {
        const record: number[] = [];
        const source = recordedSource({
            source: xoroshiro128plusFromState(choices.state),
            words: choices.words,
            cursor: 0
        }, function observe(index, word) {
            record[index] = word;
        }, context);
        const input = generateInput(generator, new Random(source), undefined, context);
        return {
            input,
            choices: {
                state: choices.state,
                words: record.map(function retain(word) {
                    context.consumeWork();
                    return word;
                })
            }
        };
    }
    function fresh(): Candidate<Value> {
        const state = random.getState();
        if (state === undefined) {
            throw new Error('Property randomness requires reconstructible state.');
        }
        return { input: generateInput(generator, random, undefined, context), choices: { state, words: [] } };
    }
    return {
        next() {
            context.consumeWork();
            const entries = Array.from(champions.values(), function visit(entry) {
                context.consumeWork();
                return entry;
            });
            const guided = ordinal % mutationModes === 0;
            ordinal += 1;
            const champion = guided ? entries[guidedOrdinal % Math.max(1, entries.length)] : undefined;
            if (champion === undefined || champion.candidate.choices.words.length === 0) {
                return fresh();
            }
            const choices = mutateChoices(champion.candidate.choices, random, guidedOrdinal, context);
            guidedOrdinal += 1;
            return fromChoices(choices);
        },
        accept(candidate, scores) {
            if (scores.size === 0) {
                return;
            }
            const retained = candidate.choices.words.length === 0 ? fromChoices(candidate.choices) : candidate;
            for (const [ label, score ] of scores) {
                context.consumeWork();
                champions.retain(label, { candidate: retained, score });
            }
        }
    };
}

export function invocationSearch<Value>(
    generator: PropertyGenerator<Value>,
    host: PropertyExecutionHost,
    identity: string,
    context: GeneratorContext
): PropertySearch<Value> {
    return propertySearch(generator, propertyRandom(host, identity), context, host.policy.maxRetainedInputs);
}
