import type { CallableSignature } from './double-behavior.ts';

type PrimitiveValue = bigint | boolean | number | string | symbol | null | undefined;
type BuiltInPartialValue = Date | Error | Promise<unknown> | RegExp;

type DeepPartialValue<Value> = Value extends PrimitiveValue ? Value : DeepPartialReference<Value>;

type DeepPartialReference<Value> = Value extends CallableSignature ? Value : DeepPartialBuiltIn<Value>;

type DeepPartialBuiltIn<Value> = Value extends BuiltInPartialValue ? Value : DeepPartialMap<Value>;

type DeepPartialMapValue<Key, EntryValue> = ReadonlyMap<DeepPartialValue<Key>, DeepPartialValue<EntryValue>>;

type DeepPartialMap<Value> = Value extends ReadonlyMap<infer Key, infer EntryValue>
    ? DeepPartialMapValue<Key, EntryValue>
    : DeepPartialSet<Value>;

type DeepPartialSet<Value> = Value extends ReadonlySet<infer EntryValue> ? ReadonlySet<DeepPartialValue<EntryValue>>
    : DeepPartialArray<Value>;

type DeepPartialArrayValue<EntryValue> = readonly DeepPartialValue<EntryValue>[];

type DeepPartialArray<Value> = Value extends readonly (infer EntryValue)[] ? DeepPartialArrayValue<EntryValue>
    : DeepPartialObject<Value>;

type DeepPartialObject<Value> = Value extends Readonly<Record<PropertyKey, unknown>>
    ? { readonly [Key in keyof Value]?: DeepPartialValue<Value[Key]>; }
    : Value;

type TuplePrefix<Arguments extends readonly unknown[]> = Arguments extends readonly [infer First, ...infer Rest]
    ? readonly [DeepPartialValue<First>, ...TuplePrefix<Rest>] | readonly [DeepPartialValue<First>]
    : never;

export type NonEmptyArgumentPatterns<Arguments extends readonly unknown[]> = number extends Arguments['length']
    ? readonly [DeepPartialValue<Arguments[number]>, ...DeepPartialValue<Arguments[number]>[]]
    : TuplePrefix<Arguments>;
