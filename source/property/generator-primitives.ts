import * as backend from 'fast-check';
import { createGenerator, prepareGenerator, type Generator as PropertyGenerator } from './generator.ts';
import {
    bigintBounds,
    effectiveLength,
    lengthBounds,
    numberBounds,
    type BigintBounds,
    type GeneratorConstant,
    type LengthBounds,
    type NumberBounds
} from './generator-constraints.ts';

export function boolean(): PropertyGenerator<boolean> {
    return createGenerator(function () {
        return backend.boolean();
    }, null);
}

export function integer(bounds: NumberBounds): PropertyGenerator<number> {
    const constraints = numberBounds(bounds, true);
    return createGenerator(function () {
        return backend.integer(constraints);
    }, null);
}

export function number(...bounds: readonly [] | readonly [NumberBounds]): PropertyGenerator<number> {
    const constraints = bounds.length === 0
        ? {}
        : { ...numberBounds(bounds[0], false), noNaN: true, noDefaultInfinity: true };
    return createGenerator(function () {
        return backend.double(constraints);
    }, null);
}

export function bigint(bounds: BigintBounds): PropertyGenerator<bigint> {
    const constraints = bigintBounds(bounds);
    return createGenerator(function () {
        return backend.bigInt(constraints);
    }, null);
}

function ensureScalar(value: unknown): void {
    if (
        value !== null && value !== undefined &&
        ![ 'bigint', 'boolean', 'number', 'string' ].includes(typeof value)
    ) {
        throw new TypeError('Generator constants must be scalar values.');
    }
}

export function constant<const Value extends GeneratorConstant>(value: Value): PropertyGenerator<Value> {
    ensureScalar(value);
    return createGenerator(function () {
        return backend.constant(value);
    }, null);
}

export function string(...bounds: readonly [] | readonly [LengthBounds]): PropertyGenerator<string> {
    const constraints = bounds.length === 0 ? null : lengthBounds(bounds[0]);
    const unit = integer({ min: 0, max: 65_535 });
    return createGenerator(function (context) {
        return backend
            .array(
                prepareGenerator(unit, context),
                { ...effectiveLength(constraints, context), size: 'small' }
            )
            .map(
                function stringFromUnits(units) {
                    context.consumeWork();
                    return units
                        .map(function codeUnit(value) {
                            return String.fromCodePoint(value);
                        })
                        .join('');
                },
                function unitsFromString(value) {
                    if (typeof value !== 'string') {
                        throw new TypeError('String generators require string values.');
                    }
                    return Array.from({ length: value.length }, function codeUnitAt(_value, index) {
                        context.consumeWork();
                        // eslint-disable-next-line unicorn/prefer-code-point -- String bounds count UTF-16 code units, including lone surrogates.
                        return value.charCodeAt(index);
                    });
                }
            );
    }, null);
}

export function bytes(...bounds: readonly [] | readonly [LengthBounds]): PropertyGenerator<Uint8Array> {
    const constraints = bounds.length === 0 ? null : lengthBounds(bounds[0]);
    const byte = integer({ min: 0, max: 255 });
    return createGenerator<Uint8Array>(function (context) {
        return backend
            .array(
                prepareGenerator(byte, context),
                { ...effectiveLength(constraints, context), size: 'small' }
            )
            .map(function ownedBytes(values) {
                context.consumeWork();
                return Uint8Array.from(values);
            });
    }, null);
}
