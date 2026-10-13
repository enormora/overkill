type PropertyCodecScalar = bigint | boolean | number | string | null | undefined;
type PropertyCodecBinary = ArrayBuffer | ArrayBufferView;
type PropertyCodecBuiltIn = Date | PropertyCodecBinary | RegExp;
type PropertyCodecMap = ReadonlyMap<PropertyCodecPayload, PropertyCodecPayload>;
type PropertyCodecCollection = PropertyCodecMap | ReadonlySet<PropertyCodecPayload>;
type PropertyCodecRecord = { readonly [key: string]: PropertyCodecPayload; };
type PropertyCodecObject = PropertyCodecBuiltIn | PropertyCodecCollection | PropertyCodecRecord;

export type PropertyCodecPayload = PropertyCodecObject | PropertyCodecScalar | readonly PropertyCodecPayload[];

export type PropertyCodecDecoder<Value> = {
    readonly version: number;
    readonly decode: (payload: unknown) => Value;
};

export type PropertyInputCodec<Value> = PropertyCodecDecoder<Value> & {
    readonly name: string;
    readonly encode: (value: Value) => PropertyCodecPayload;
    readonly previousDecoders: readonly PropertyCodecDecoder<Value>[];
};
