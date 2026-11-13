import { isMatching, type P } from 'ts-pattern';
import type { ArgumentShape } from './argument-shape.ts';

const argumentMatcherIdentity: unique symbol = Symbol.for('OverkillArgumentMatcher');
const argumentMatcherType: unique symbol = Symbol('ArgumentMatcherType');

type InferredValue<Pattern> = ArgumentShape<P.infer<Pattern>, 'evidence'>;

type RuntimeArgumentMatcher = {
    readonly [argumentMatcherIdentity]: true;
    readonly pattern: unknown;
    readonly matches: (value: unknown) => boolean;
};

export type ArgumentMatcherFor<Value, Pattern = unknown> = RuntimeArgumentMatcher & {
    readonly pattern: Pattern;
    readonly [argumentMatcherType]: (accept: (value: Value) => void) => void;
};

type TypedArgumentMatcher<Pattern> = ArgumentMatcherFor<InferredValue<Pattern>, Pattern>;

export type ArgumentMatcher<Pattern = unknown> = unknown extends Pattern ? RuntimeArgumentMatcher
    : TypedArgumentMatcher<Pattern>;

export function matches<const Pattern extends P.Pattern>(pattern: Pattern): TypedArgumentMatcher<Pattern> {
    return Object.freeze<TypedArgumentMatcher<Pattern>>({
        [argumentMatcherIdentity]: true,
        [argumentMatcherType]() {
            return undefined;
        },
        pattern,
        matches: isMatching(pattern)
    });
}

export function isArgumentMatcher(value: unknown): value is ArgumentMatcher {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return Reflect.get(value, argumentMatcherIdentity) === true &&
        Object.hasOwn(value, 'pattern') && typeof Reflect.get(value, 'matches') === 'function';
}
