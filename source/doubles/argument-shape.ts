import type { LiteralToPrimitive } from 'type-fest';

type CallableValue = (...arguments_: readonly never[]) => unknown;

type PrimitiveValue = bigint | boolean | number | string | symbol | null | undefined;
type BuiltInPartialValue = Date | Error | Promise<unknown> | RegExp;

type ShapeMode = 'evidence' | 'pattern' | 'raw';

export type ArgumentShape<Value, Mode extends ShapeMode = 'raw'> = unknown extends Value ? UnknownShape<Mode>
    : KnownShape<Value, Mode>;

type UnknownShape<Mode extends ShapeMode> = Mode extends 'evidence' ? never : unknown;

type PrimitiveShape<Value, Mode extends ShapeMode> = Mode extends 'pattern' ? LiteralToPrimitive<Value> : Value;

type KnownShape<Value, Mode extends ShapeMode> = Value extends PrimitiveValue ? PrimitiveShape<Value, Mode>
    : ReferenceShape<Value, Mode>;

type ReferenceShape<Value, Mode extends ShapeMode> = Value extends CallableValue ? Value : BuiltInShape<Value, Mode>;

type BuiltInShape<Value, Mode extends ShapeMode> = Value extends BuiltInPartialValue ? Value
    : MapValueShape<Value, Mode>;

type MapShape<Key, EntryValue, Mode extends ShapeMode> = ReadonlyMap<
    ArgumentShape<Key, Mode>,
    ArgumentShape<EntryValue, Mode>
>;

type MapValueShape<Value, Mode extends ShapeMode> = Value extends ReadonlyMap<infer Key, infer EntryValue>
    ? MapShape<Key, EntryValue, Mode>
    : SetShape<Value, Mode>;

type SetShape<Value, Mode extends ShapeMode> = Value extends ReadonlySet<infer EntryValue>
    ? ReadonlySet<ArgumentShape<EntryValue, Mode>>
    : ArrayValueShape<Value, Mode>;

type ArrayShape<EntryValue, Mode extends ShapeMode> = readonly ArgumentShape<EntryValue, Mode>[];

type ArrayValueShape<Value, Mode extends ShapeMode> = Value extends readonly (infer EntryValue)[]
    ? ArrayShape<EntryValue, Mode>
    : ObjectShape<Value, Mode>;

type ObjectShape<Value, Mode extends ShapeMode> = Value extends Readonly<Record<PropertyKey, unknown>>
    ? { readonly [Key in keyof Value]?: ArgumentShape<Value[Key], Mode>; }
    : Value;
