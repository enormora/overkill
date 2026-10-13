import type { PropertyInputCodec } from './property-codec.ts';

export const generatorBrand = Symbol.for('@overkill-dev/property/Generator');

export type Generator<Value> = {
    readonly [generatorBrand]: true;
    readonly map: <Output>(transform: (value: Value) => Output) => Generator<Output>;
    readonly flatMap: <Output>(transform: (value: Value) => Generator<Output>) => Generator<Output>;
    readonly filter: (predicate: (value: Value) => boolean) => Generator<Value>;
    readonly withCodec: (codec: PropertyInputCodec<Value>) => Generator<Value>;
};

export function ensureGenerator(value: unknown): void {
    if (
        typeof value !== 'object' || value === null ||
        Reflect.get(value, generatorBrand) !== true ||
        [ 'map', 'flatMap', 'filter', 'withCodec' ].some(function isMissingGeneratorMethod(method) {
            return typeof Reflect.get(value, method) !== 'function';
        })
    ) {
        throw new TypeError('Property requires an Overkill generator.');
    }
}
