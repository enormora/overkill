import {
    runtime,
    runtimeDimension,
    runtimeVariant,
    type RunFilter
} from '../run/filters.entry-point.ts';

function invalidRuntimeSelector(expression: string): TypeError {
    const syntax = '<runtime>, <runtime>:<variant>, or <runtime>.<dimension>=<value>';

    return new TypeError(`Runtime selector must use ${syntax}: ${expression}`);
}

function parseRuntimeDimensionSelector(expression: string, equalsIndex: number): RunFilter {
    const identity = expression.slice(0, equalsIndex);
    const dimensionSeparatorIndex = identity.lastIndexOf('.');
    const runtimeName = identity.slice(0, dimensionSeparatorIndex);
    const dimensionName = identity.slice(dimensionSeparatorIndex + 1);
    const value = expression.slice(equalsIndex + 1);

    if (
        dimensionSeparatorIndex <= 0 ||
        runtimeName.includes(':') ||
        dimensionName.length === 0 ||
        value.length === 0
    ) {
        throw invalidRuntimeSelector(expression);
    }

    return runtimeDimension(runtimeName, dimensionName, value);
}

function parseRuntimeVariantSelector(expression: string, variantSeparatorIndex: number): RunFilter {
    const runtimeName = expression.slice(0, variantSeparatorIndex);
    const variantId = expression.slice(variantSeparatorIndex + 1);

    if (variantSeparatorIndex === 0 || variantId.length === 0 || variantId.includes(':')) {
        throw invalidRuntimeSelector(expression);
    }

    return runtimeVariant(runtimeName, variantId);
}

export function parseRuntimeSelector(expression: string): RunFilter {
    const equalsIndex = expression.indexOf('=');

    if (equalsIndex !== -1) {
        return parseRuntimeDimensionSelector(expression, equalsIndex);
    }

    const variantSeparatorIndex = expression.indexOf(':');

    if (variantSeparatorIndex !== -1) {
        return parseRuntimeVariantSelector(expression, variantSeparatorIndex);
    }

    try {
        return runtime(expression);
    } catch {
        throw invalidRuntimeSelector(expression);
    }
}
