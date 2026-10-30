import type { Writable } from 'type-fest';
import { z } from 'zod/v4';
import { defineCodec } from '../property/property-codec.ts';

type OwnedErrorInput = { readonly values: Writable<readonly number[]>; readonly owner: TypeError; };

export const propertyErrorInputCodec = defineCodec({
    name: 'owned-error',
    version: 1,
    previousDecoders: [],
    encode(value: OwnedErrorInput) {
        return { values: value.values, message: value.owner.message };
    },
    decode(payload): OwnedErrorInput {
        const value = z.object({ values: z.array(z.number()), message: z.string() }).parse(payload);
        return { values: value.values, owner: new TypeError(value.message) };
    }
});
