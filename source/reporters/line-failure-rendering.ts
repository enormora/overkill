import { inspect } from 'node:util';
import colors from 'yoctocolors';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import type { TestFailure } from '../engine/run-result.ts';

const bytesPerBinaryKilobyte = 1024;
const valueBinaryKilobytes = 8;
const valueByteLimit = valueBinaryKilobytes * bytesPerBinaryKilobyte;
const blockLineLimit = 100;
const stringContextGraphemes = 16;
const shallowHintLimit = 5;

type InspectableObject = Readonly<Record<string, unknown>> | readonly unknown[];

function byteLength(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}

function truncateBytes(value: string): string {
    if (byteLength(value) <= valueByteLimit) {
        return value;
    }

    let truncated = '';

    for (const character of value) {
        const next = `${truncated}${character}`;

        if (byteLength(next) > valueByteLimit) {
            break;
        }

        truncated = next;
    }

    return `${truncated}\n... truncated after ${valueByteLimit} bytes`;
}

function truncateLines(value: string): string {
    const lines = value.split('\n');

    if (lines.length <= blockLineLimit) {
        return value;
    }

    return [
        ...lines.slice(0, blockLineLimit),
        `... truncated ${lines.length - blockLineLimit} lines`
    ]
        .join('\n');
}

function truncateRenderedValue(value: string): string {
    return truncateLines(truncateBytes(value));
}

function formatBooleanNumberOrUndefined(value: unknown): string | null {
    if (typeof value === 'boolean' || typeof value === 'number' || value === undefined) {
        return String(value);
    }

    return null;
}

function formatPrimitive(value: unknown): string | null {
    const rendered = formatBooleanNumberOrUndefined(value);

    if (rendered !== null) {
        return rendered;
    }

    if (value === null) {
        return 'null';
    }

    if (typeof value === 'string') {
        return JSON.stringify(value);
    }

    if (typeof value === 'bigint') {
        return `${value}n`;
    }

    return typeof value === 'symbol' ? value.toString() : null;
}

function formatValue(value: unknown): string {
    const primitive = formatPrimitive(value);

    if (primitive !== null) {
        return primitive;
    }

    if (value instanceof Error) {
        return `${value.name}: ${value.message}`;
    }

    return truncateRenderedValue(inspect(value, {
        breakLength: 80,
        colors: false,
        compact: false,
        depth: 4,
        maxArrayLength: 20,
        maxStringLength: valueByteLimit,
        sorted: true
    }));
}

function firstStringDifference(expected: string, actual: string): number | null {
    const length = Math.max(expected.length, actual.length);

    for (let index = 0; index < length; index += 1) {
        if (expected[index] !== actual[index]) {
            return index;
        }
    }

    return null;
}

function graphemeSegments(value: string): readonly Intl.SegmentData[] {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

    return Array.from(segmenter.segment(value));
}

function stringWindow(value: string, codeUnitIndex: number): string {
    const segments = graphemeSegments(value);
    const segmentIndex = Math.max(
        0,
        segments.findIndex(function containsIndex(segment, index) {
            const nextIndex = segments[index + 1]?.index ?? value.length;

            return codeUnitIndex >= segment.index && codeUnitIndex < nextIndex;
        })
    );
    const start = Math.max(0, segmentIndex - stringContextGraphemes);
    const end = Math.min(segments.length, segmentIndex + stringContextGraphemes + 1);
    const prefix = start === 0 ? '' : '...';
    const suffix = end === segments.length ? '' : '...';
    const window = segments
        .slice(start, end)
        .map(function toSegment(segment) {
            return segment.segment;
        })
        .join('');

    return `${prefix}${window}${suffix}`;
}

function formatStringComparison(expected: string, actual: string): readonly string[] {
    const difference = firstStringDifference(expected, actual);
    const windowIndex = difference ?? 0;
    const normalizationNote = expected !== actual && expected.normalize('NFC') === actual.normalize('NFC')
        ? [ 'note: strings are equal after canonical Unicode normalization' ]
        : [];

    return [
        `first difference at code unit ${windowIndex}`,
        ...normalizationNote,
        `expected (${expected.length} code units): ${JSON.stringify(stringWindow(expected, windowIndex))}`,
        `actual (${actual.length} code units):   ${JSON.stringify(stringWindow(actual, windowIndex))}`
    ];
}

function formatPath(path: FailedCheck['path']): string {
    return path
        .map(function formatSegment(segment) {
            if (typeof segment === 'number') {
                return `[${segment}]`;
            }

            return /^[A-Za-z_$][\w$]*$/u.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
        })
        .join('');
}

function formatLocation(location: FailedCheck['location']): string | null {
    if (location.file.length === 0) {
        return null;
    }

    if (location.line === null) {
        return location.file;
    }

    if (location.column === null) {
        return `${location.file}:${location.line}`;
    }

    return `${location.file}:${location.line}:${location.column}`;
}

function isInspectableObject(value: unknown): value is InspectableObject {
    return typeof value === 'object' && value !== null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return isInspectableObject(value) && !Array.isArray(value);
}

function formatArrayHint(expected: readonly unknown[], actual: readonly unknown[]): string {
    if (expected.length !== actual.length) {
        return `reference differs; array lengths differ: expected ${expected.length}, actual ${actual.length}`;
    }

    const index = expected.findIndex(function differs(expectedItem, itemIndex) {
        return !Object.is(expectedItem, actual[itemIndex]);
    });

    return index === -1
        ? 'reference differs; shallow contents match'
        : `reference differs; shallow difference at [${index}]`;
}

function sortedKeys(value: Readonly<Record<string, unknown>>): readonly string[] {
    return Object.keys(value).toSorted(function compareKeys(first, second) {
        return first.localeCompare(second);
    });
}

function formatObjectHint(
    expected: Readonly<Record<string, unknown>>,
    actual: Readonly<Record<string, unknown>>
): string {
    const expectedKeys = sortedKeys(expected);
    const actualKeys = sortedKeys(actual);
    const expectedKeySet = new Set(expectedKeys);
    const actualKeySet = new Set(actualKeys);
    const differences = [
        ...expectedKeys.flatMap(function missingOrChanged(key) {
            if (!actualKeySet.has(key)) {
                return [ `missing ${key}` ];
            }

            return Object.is(expected[key], actual[key]) ? [] : [ `changed ${key}` ];
        }),
        ...actualKeys.flatMap(function extra(key) {
            return expectedKeySet.has(key) ? [] : [ `extra ${key}` ];
        })
    ];
    const leadingDifferences = differences.slice(0, shallowHintLimit).join(', ');

    return differences.length === 0
        ? 'reference differs; shallow contents match'
        : `reference differs; shallow differences: ${leadingDifferences}`;
}

function formatRecordOrObjectHint(expected: unknown, actual: unknown): string | null {
    if (!isInspectableObject(expected) || !isInspectableObject(actual)) {
        return null;
    }

    return isRecord(expected) && isRecord(actual)
        ? formatObjectHint(expected, actual)
        : 'reference differs; value types differ';
}

function formatShallowHint(expected: unknown, actual: unknown): string | null {
    if (Array.isArray(expected) && Array.isArray(actual)) {
        return formatArrayHint(expected, actual);
    }

    return formatRecordOrObjectHint(expected, actual);
}

function formatValueLines(label: 'actual' | 'expected', value: unknown): readonly string[] {
    const rendered = formatValue(value);
    const lines = rendered.split('\n');

    if (lines.length === 1) {
        return [ `${label}: ${lines[0]}` ];
    }

    return [
        `${label}:`,
        ...lines.map(function indentValueLine(line) {
            return `  ${line}`;
        })
    ];
}

function formatNonStringCheckDetails(check: FailedCheck): readonly string[] {
    if (check.kind === 'foreign') {
        return [];
    }

    const shallowHint = formatShallowHint(check.expected, check.actual);

    return [
        ...shallowHint === null ? [] : [ shallowHint ],
        ...formatValueLines('expected', check.expected),
        ...formatValueLines('actual', check.actual)
    ];
}

function formatFailedCheck(check: FailedCheck): readonly string[] {
    const path = formatPath(check.path);
    const location = formatLocation(check.location);
    const detailLines = check.kind === 'foreign'
        ? [
            `foreign assertion: ${check.label}`,
            `${check.error.name}: ${check.error.message}`
        ]
        : Array.from(
            typeof check.expected === 'string' && typeof check.actual === 'string'
                ? formatStringComparison(check.expected, check.actual)
                : formatNonStringCheckDetails(check)
        );

    return [
        check.summary,
        ...path.length === 0 ? [] : [ `path: ${path}` ],
        ...location === null ? [] : [ `location: ${location}` ],
        ...detailLines
    ];
}

function formatTestContractFailure(
    failure: Extract<TestFailure, { readonly kind: 'test-contract'; }>
): readonly string[] {
    return [
        `${failure.summary} (${failure.code})`,
        `expected: ${failure.expected}`,
        `actual: ${formatValue(failure.actual)}`
    ];
}

function formatBodyErrorFailure(failure: Extract<TestFailure, { readonly kind: 'body-error'; }>): readonly string[] {
    const stackLines = failure.error.stack === null
        ? []
        : truncateRenderedValue(failure.error.stack).split('\n').map(function dimStackLine(line) {
            return colors.dim(line);
        });

    return [
        `${failure.error.name}: ${failure.error.message}`,
        ...stackLines
    ];
}

function formatAssertionFailure(failure: Extract<TestFailure, { readonly kind: 'assertion'; }>): readonly string[] {
    return failure.checks.flatMap(function formatCheck(check, index) {
        const prefix = failure.checks.length === 1 ? [] : [ `check ${index + 1}` ];

        return [ ...prefix, ...formatFailedCheck(check) ];
    });
}

export function formatFailure(failure: TestFailure): readonly string[] {
    if (failure.kind === 'assertion') {
        return formatAssertionFailure(failure);
    }

    if (failure.kind === 'body-error') {
        return formatBodyErrorFailure(failure);
    }

    return formatTestContractFailure(failure);
}
