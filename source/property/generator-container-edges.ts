import { effectiveLength, type LengthBounds } from './generator-constraints.ts';
import type { GeneratorContext } from './generator-backend.ts';
import type { GeneratorEdgeSource } from './generator-edges.ts';

const maximumByte = 255;
const highSurrogateCodeUnit = 55_296;
const lowSurrogateCodeUnit = 56_319;
const stringEdgeUnits = [
    '\0',
    'a',
    String.fromCodePoint(highSurrogateCodeUnit),
    String.fromCodePoint(lowSurrogateCodeUnit)
];

export function edgeLengths(bounds: LengthBounds | null, context: GeneratorContext): ReadonlySet<number> {
    const lengths = effectiveLength(bounds, context);
    return new Set([ lengths.minLength, lengths.maxLength ]);
}

export function stringEdges(bounds: LengthBounds | null): GeneratorEdgeSource<string> {
    return function* edges(context) {
        const lengths = edgeLengths(bounds, context);
        for (const length of lengths) {
            const units = length === 0 ? [ '' ] : stringEdgeUnits;
            for (const unit of units) {
                context.consumeWork();
                yield function reconstructString() {
                    context.consumeWork();
                    return unit.repeat(length);
                };
            }
        }
    };
}

export function byteEdges(bounds: LengthBounds | null): GeneratorEdgeSource<Uint8Array> {
    return function* edges(context) {
        const lengths = edgeLengths(bounds, context);
        for (const length of lengths) {
            const values = length === 0 ? [ 0 ] : [ 0, maximumByte ];
            for (const value of values) {
                context.consumeWork();
                yield function reconstructBytes() {
                    context.consumeWork();
                    const bytes = new Uint8Array(length);
                    return bytes.fill(value);
                };
            }
        }
    };
}
