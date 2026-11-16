import type { P } from 'ts-pattern';
import type { ArgumentMatcherFor } from './argument-matcher.ts';
import type { ArgumentShape } from './argument-shape.ts';

type TuplePrefix<Tuple extends readonly unknown[]> = number extends Tuple['length'] ? never : FiniteTuplePrefix<Tuple>;

type FiniteTuplePrefix<Tuple extends readonly unknown[]> = Tuple extends readonly [] ? never
    : NonEmptyTuplePrefix<Tuple>;

type NonEmptyTuplePrefix<Tuple extends readonly unknown[]> = Tuple extends readonly [unknown?, ...infer Rest]
    ? readonly [ArgumentValue<Tuple[0]>, ...TuplePrefix<Rest>] | readonly [ArgumentValue<Tuple[0]>]
    : never;

export type NonEmptyArgumentPatterns<Arguments extends readonly unknown[]> = number extends Arguments['length']
    ? readonly [ArgumentValue<Arguments[number]>, ...ArgumentValue<Arguments[number]>[]]
    : TuplePrefix<Arguments>;

type PatternArgument<Value> = ArgumentMatcherFor<ArgumentShape<Value, 'pattern'>, P.Pattern<Value>>;

type ArgumentValue<Value> = ArgumentShape<Value> | PatternArgument<Value>;
