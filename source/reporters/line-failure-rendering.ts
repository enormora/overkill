import colors from 'yoctocolors';
import type { SerializedValue } from '../compare/serialized-value.ts';
import type {
    ArrayDiffOperation,
    Diff,
    DiffPathSegment,
    MapDiffOperation,
    ObjectDiffOperation,
    SetDiffOperation
} from '../diff/diff-shape.ts';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import type { TestFailure } from '../engine/run-result.ts';
import { formatSerializedValue, keyText } from './serialized-value-rendering.ts';

const blockLineLimit = 100;
const bytesPerKilobyte = 1024;
const valueKilobytes = 8;
const valueByteLimit = valueKilobytes * bytesPerKilobyte;

type PropertySegment = Extract<DiffPathSegment, { readonly kind: 'property'; }>;

type MapSegment = Extract<DiffPathSegment, { readonly kind: 'map-key' | 'map-value'; }>;

type SetSegment = Extract<DiffPathSegment, { readonly kind: 'set-value'; }>;

type KeyedSegment = MapSegment | PropertySegment | SetSegment;

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

function formatPropertySegment(segment: PropertySegment): string {
    const key = keyText(segment.key);

    return /^[A-Za-z_$][\w$]*$/u.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function isPropertySegment(segment: KeyedSegment): segment is PropertySegment {
    return segment.kind === 'property';
}

function formatKeyedSegment(segment: KeyedSegment): string {
    if (segment.kind === 'set-value') {
        return `[set ${formatSerializedValue(segment.value)}]`;
    }

    if (segment.kind === 'map-key') {
        return `[map key ${formatSerializedValue(segment.key)}]`;
    }

    if (segment.kind === 'map-value') {
        return `[map value ${formatSerializedValue(segment.key)}]`;
    }

    return isPropertySegment(segment) ? formatPropertySegment(segment) : '';
}

function formatSegment(segment: DiffPathSegment): string {
    if (segment.kind === 'index') {
        return `[${segment.index}]`;
    }

    return segment.kind === 'byte' ? `[byte ${segment.offset}]` : formatKeyedSegment(segment);
}

function formatPath(path: readonly DiffPathSegment[]): string {
    return path.map(formatSegment).join('');
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

function formatSerializedValueLines(label: 'actual' | 'expected', value: SerializedValue): readonly string[] {
    return [ `${label}: ${truncateRenderedValue(formatSerializedValue(value))}` ];
}

function formatObjectOperation(operation: ObjectDiffOperation): string {
    if (operation.operation === 'replace') {
        return `replace ${formatPath(operation.path)}: expected ${formatSerializedValue(operation.from)}, actual ${
            formatSerializedValue(operation.to)
        }`;
    }

    if (operation.operation === 'add') {
        return `add ${formatPath(operation.path)}: ${formatSerializedValue(operation.value)}`;
    }

    if (operation.operation === 'remove') {
        return `remove ${formatPath(operation.path)}: ${formatSerializedValue(operation.value)}`;
    }

    return `missing ${formatPath(operation.path)}: ${formatSerializedValue(operation.value)}`;
}

function formatArrayOperation(operation: ArrayDiffOperation): string {
    if (operation.operation === 'missing-index') {
        return `missing [${operation.index}]: ${formatSerializedValue(operation.value)}`;
    }

    if (operation.operation === 'missing-member') {
        return `missing array member: ${formatSerializedValue(operation.value)}`;
    }

    return formatObjectOperation(operation);
}

function formatMapOperation(operation: MapDiffOperation): string {
    if (operation.operation === 'missing-entry') {
        return `missing map entry ${formatSerializedValue(operation.key)}: ${formatSerializedValue(operation.value)}`;
    }

    return formatObjectOperation(operation);
}

function formatSetOperation(operation: SetDiffOperation): string {
    if (operation.operation === 'missing-member') {
        return `missing set member: ${formatSerializedValue(operation.value)}`;
    }

    return formatObjectOperation(operation);
}

function formatValueDiff(diff: Extract<Diff, { readonly kind: 'value'; }>): readonly string[] {
    return [
        ...formatSerializedValueLines('expected', diff.expected),
        ...formatSerializedValueLines('actual', diff.actual)
    ];
}

function formatStringDiff(diff: Extract<Diff, { readonly kind: 'string'; }>): readonly string[] {
    return diff.hunks.flatMap(function formatHunk(hunk) {
        return [
            `string hunk expected ${hunk.expectedStart}, actual ${hunk.actualStart}`,
            ...hunk.removed.map(function removed(line) {
                return `- ${line}`;
            }),
            ...hunk.added.map(function added(line) {
                return `+ ${line}`;
            })
        ];
    });
}

function formatCollectionDiff(diff: Diff): readonly string[] | null {
    if (diff.kind === 'object') {
        return diff.operations.map(formatObjectOperation);
    }

    if (diff.kind === 'array') {
        return diff.operations.map(formatArrayOperation);
    }

    if (diff.kind === 'map') {
        return diff.operations.map(formatMapOperation);
    }

    if (diff.kind === 'set') {
        return diff.operations.map(formatSetOperation);
    }

    return null;
}

function formatBinaryDiff(diff: Extract<Diff, { readonly kind: 'binary'; }>): readonly string[] {
    const expectedSummary = `expected ${diff.expectedSize} bytes ${diff.expectedHash}`;
    const actualSummary = `actual ${diff.actualSize} bytes ${diff.actualHash}`;
    const header = `binary differs: ${expectedSummary}, ${actualSummary}`;

    return [
        header,
        ...diff.ranges.map(function formatRange(range) {
            return `byte ${range.offset}: expected [${range.expected.join(', ')}], actual [${range.actual.join(', ')}]`;
        })
    ];
}

function formatDiff(diff: Diff): readonly string[] {
    if (diff.kind === 'value') {
        return formatValueDiff(diff);
    }

    if (diff.kind === 'string') {
        return formatStringDiff(diff);
    }

    const collection = formatCollectionDiff(diff);

    if (collection !== null) {
        return collection;
    }

    return diff.kind === 'binary' ? formatBinaryDiff(diff) : [];
}

function failedCheckDetailLines(check: FailedCheck): readonly string[] {
    if (check.kind === 'foreign') {
        return [
            `foreign assertion: ${check.label}`,
            `${check.error.name}: ${check.error.message}`
        ];
    }

    return check.diff === null
        ? [
            ...formatSerializedValueLines('expected', check.expected),
            ...formatSerializedValueLines('actual', check.actual)
        ]
        : formatDiff(check.diff);
}

function formatFailedCheck(check: FailedCheck): readonly string[] {
    const path = formatPath(check.path);
    const location = formatLocation(check.location);
    const detailLines = failedCheckDetailLines(check);
    const childLines = check.kind === 'composite'
        ? check.children.flatMap(function formatChild(child, index) {
            return [
                `child check ${index + 1}`,
                ...formatFailedCheck(child).map(function indentChild(line) {
                    return `  ${line}`;
                })
            ];
        })
        : [];

    return [
        check.summary,
        ...path.length === 0 ? [] : [ `path: ${path}` ],
        ...location === null ? [] : [ `location: ${location}` ],
        ...detailLines,
        ...childLines
    ];
}

function formatTestContractFailure(
    failure: Extract<TestFailure, { readonly kind: 'test-contract'; }>
): readonly string[] {
    return [
        `${failure.summary} (${failure.code})`,
        `expected: ${failure.expected}`,
        `actual: ${truncateRenderedValue(String(failure.actual))}`
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
