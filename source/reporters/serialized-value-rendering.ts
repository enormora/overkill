import type { SerializedPropertyKey, SerializedValue } from '../compare/serialized-value.ts';

type SerializedEntry = {
    readonly key: SerializedPropertyKey;
    readonly value: SerializedValue;
};

type SerializedValueFormatter = (value: SerializedValue) => string | null;

type RecursiveSerializedValueFormatter = (value: SerializedValue) => string;

export function keyText(key: SerializedPropertyKey): string {
    return key.kind === 'symbol' ? `[${key.value}]` : key.value;
}

function formatEntries(entries: readonly SerializedEntry[], format: RecursiveSerializedValueFormatter): string {
    return `{ ${
        entries
            .map(function formatEntry(entry) {
                return `${keyText(entry.key)}: ${format(entry.value)}`;
            })
            .join(', ')
    } }`;
}

function formatNullishValue(value: SerializedValue): string | null {
    if (value.kind === 'undefined') {
        return 'undefined';
    }

    return value.kind === 'null' ? 'null' : null;
}

function formatScalarValue(value: SerializedValue): string | null {
    if (value.kind === 'boolean' || value.kind === 'number') {
        return String(value.value);
    }

    return value.kind === 'bigint' ? `${value.value}n` : null;
}

function formatTextValue(value: SerializedValue): string | null {
    if (value.kind === 'string') {
        const rendered = JSON.stringify(value.value);

        return value.truncation === null
            ? rendered
            : `${rendered} (truncated at ${value.truncation.budget} bytes)`;
    }

    return value.kind === 'symbol' ? value.value : null;
}

function formatFunctionValue(value: SerializedValue): string | null {
    if (value.kind !== 'function') {
        return null;
    }

    return value.name === null ? '[Function]' : `[Function ${value.name}]`;
}

function formatCollectionValue(value: SerializedValue, format: RecursiveSerializedValueFormatter): string | null {
    if (value.kind === 'array') {
        return `[${
            value
                .entries
                .map(function formatArrayEntry(entry) {
                    return format(entry.value);
                })
                .join(', ')
        }]`;
    }

    if (value.kind === 'object') {
        return `${value.constructorName} ${formatEntries(value.entries, format)}`;
    }

    if (value.kind === 'map') {
        return `Map(${value.size})`;
    }

    return value.kind === 'set' ? `Set(${value.size})` : null;
}

function formatBuiltInValue(value: SerializedValue): string | null {
    if (value.kind === 'date') {
        return value.value === null ? 'Invalid Date' : `Date ${value.value}`;
    }

    if (value.kind === 'regexp') {
        return `/${value.source}/${value.flags}`;
    }

    return value.kind === 'error' ? `${value.name}: ${value.message}` : null;
}

function formatByteValue(value: SerializedValue): string | null {
    if (value.kind === 'array-buffer' || value.kind === 'data-view') {
        return `${value.kind}(${value.byteLength} bytes)`;
    }

    return value.kind === 'typed-array' ? `${value.constructorName}(${value.length})` : null;
}

function formatFallbackValue(value: SerializedValue): string | null {
    if (value.kind === 'circular') {
        return `[Circular ${value.reference}]`;
    }

    if (value.kind === 'opaque') {
        return `[${value.type}]`;
    }

    return value.kind === 'unavailable' ? `[Unavailable: ${value.reason}]` : null;
}

const scalarRenderers = [
    formatNullishValue,
    formatScalarValue,
    formatTextValue,
    formatFunctionValue
];

const referenceRenderers = [
    formatBuiltInValue,
    formatByteValue,
    formatFallbackValue
];

function formatWithRenderers(value: SerializedValue, renderers: readonly SerializedValueFormatter[]): string | null {
    for (const renderer of renderers) {
        const rendered = renderer(value);

        if (rendered !== null) {
            return rendered;
        }
    }

    return null;
}

export function formatSerializedValue(value: SerializedValue): string {
    const scalar = formatWithRenderers(value, scalarRenderers);

    if (scalar !== null) {
        return scalar;
    }

    const collection = formatCollectionValue(value, formatSerializedValue);

    return collection ?? formatWithRenderers(value, referenceRenderers) ??
        '[Unavailable: unsupported serialized value]';
}
