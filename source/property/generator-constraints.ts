import { z } from 'zod';
import type { Generator as PropertyGenerator } from './generator.ts';
import type { GeneratorContext } from './generator-backend.ts';

export type NumberBounds = {
    readonly min: number;
    readonly max: number;
};

export type BigintBounds = {
    readonly min: bigint;
    readonly max: bigint;
};

export type LengthBounds = {
    readonly minLength: number;
    readonly maxLength: number;
};

export type GeneratorConstant = bigint | boolean | number | string | null | undefined;

type GeneratorVariant<Value> = Value extends unknown ? PropertyGenerator<Value> : never;
type GeneratorAlternative<Value> = GeneratorVariant<Value> | PropertyGenerator<Value>;

export type RecursiveGeneratorDefinition<Value> = {
    readonly leaf: GeneratorAlternative<Value>;
    readonly branch: (child: PropertyGenerator<Value>) => GeneratorAlternative<Value>;
    readonly maxDepth: number;
};

const nonnegativeLimitSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const numberBoundsSchema = z.object({ min: z.number(), max: z.number() }).strict().refine(
    function ordered(bounds) {
        return bounds.min <= bounds.max;
    }
);
const integerBoundsSchema = numberBoundsSchema.refine(function safeIntegers(bounds) {
    return Number.isSafeInteger(bounds.min) && Number.isSafeInteger(bounds.max);
});
const bigintBoundsSchema = z.object({ min: z.bigint(), max: z.bigint() }).strict().refine(function ordered(bounds) {
    return bounds.min <= bounds.max;
});
const lengthBoundsSchema = z
    .object({ minLength: nonnegativeLimitSchema, maxLength: nonnegativeLimitSchema })
    .strict()
    .refine(function ordered(bounds) {
        return bounds.minLength <= bounds.maxLength;
    });

function requireBoundsObject(value: unknown): void {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('Generator bounds require an object.');
    }
}

export function numberBounds(bounds: unknown, integer: boolean): NumberBounds {
    requireBoundsObject(bounds);
    const result = (integer ? integerBoundsSchema : numberBoundsSchema).safeParse(bounds);
    if (!result.success) {
        throw new RangeError(
            integer ? 'Integer bounds require ordered safe integers.' : 'Number bounds require ordered finite numbers.'
        );
    }
    return result.data;
}

export function bigintBounds(bounds: unknown): BigintBounds {
    requireBoundsObject(bounds);
    const result = bigintBoundsSchema.safeParse(bounds);
    if (!result.success) {
        throw new RangeError('Bigint bounds require ordered bigints.');
    }
    return result.data;
}

export function nonnegativeLimit(value: unknown): number {
    const result = nonnegativeLimitSchema.safeParse(value);
    if (!result.success) {
        throw new RangeError('Generator lengths and depths require nonnegative safe integers.');
    }
    return result.data;
}

export function lengthBounds(bounds: unknown): LengthBounds {
    requireBoundsObject(bounds);
    const result = lengthBoundsSchema.safeParse(bounds);
    if (!result.success) {
        throw new RangeError('Generator length bounds require ordered nonnegative safe integers.');
    }
    return result.data;
}

export function effectiveLength(bounds: LengthBounds | null, context: GeneratorContext): LengthBounds {
    const minLength = bounds === null ? 0 : bounds.minLength;
    const maxLength = Math.min(context.maxSize, bounds === null ? context.maxSize : bounds.maxLength);
    if (minLength > maxLength) {
        return context.exhaustDomain();
    }
    return { minLength, maxLength };
}
