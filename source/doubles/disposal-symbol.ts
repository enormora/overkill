function requiredWellKnownSymbol(name: 'asyncDispose' | 'dispose'): symbol {
    const value = Reflect.get(Symbol, name);

    if (typeof value !== 'symbol') {
        throw new TypeError(`Runtime does not provide Symbol.${name}.`);
    }

    return value;
}

export const asyncDisposeSymbol = requiredWellKnownSymbol('asyncDispose');
export const disposeSymbol = requiredWellKnownSymbol('dispose');
