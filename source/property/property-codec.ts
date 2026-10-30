import { z } from 'zod/v4';

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

export function defineCodec<Value>(definition: PropertyInputCodec<Value>): PropertyInputCodec<Value> {
    z
        .object({
            name: z.string().trim().min(1).refine(function customName(name) {
                return name !== 'overkill-standard-input';
            }),
            version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            encode: z.custom<unknown>(function callable(value) {
                return typeof value === 'function';
            }),
            decode: z.custom<unknown>(function callable(value) {
                return typeof value === 'function';
            }),
            previousDecoders: z.array(z.object({
                version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
                decode: z.custom<unknown>(function callable(value) {
                    return typeof value === 'function';
                })
            }))
        })
        .parse(definition);
    const versions = new Set<number>([ definition.version ]);
    const previousDecoders = definition.previousDecoders.map(
        function snapshotDecoder(decoder: PropertyCodecDecoder<Value>) {
            if (
                !Number.isSafeInteger(decoder.version) || decoder.version <= 0 ||
                decoder.version >= definition.version || versions.has(decoder.version) ||
                typeof decoder.decode !== 'function'
            ) {
                throw new TypeError('Invalid property input codec decoder.');
            }
            versions.add(decoder.version);
            return Object.freeze({ version: decoder.version, decode: decoder.decode });
        }
    );
    return Object.freeze({
        name: definition.name,
        version: definition.version,
        encode: definition.encode,
        decode: definition.decode,
        previousDecoders: Object.freeze(previousDecoders)
    });
}
