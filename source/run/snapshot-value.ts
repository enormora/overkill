import { snapshotJson } from '../attachments/json-snapshot.ts';
import type { SnapshotInput } from '../packages/baselines/execution-context.entry-point.ts';
import { persistBaselinePayload, restoreBaselinePayload } from './baseline-record.ts';

type SnapshotPayload = ReturnType<typeof persistBaselinePayload>;
const jsonIndentation = 2;

function enforceSnapshotLimit(bytes: number, maxBytes: number): void {
    if (bytes > maxBytes) {
        throw new TypeError('Snapshot exceeds its byte limit.');
    }
}

function sortedKeys(_key: string, value: unknown): unknown {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).toSorted(function compareKeys(left, right) {
                return left[0] < right[0] ? -1 : Number(left[0] > right[0]);
            })
        )
        : value;
}

function captureJsonSnapshot(value: unknown, maxBytes: number): SnapshotPayload {
    const captured = snapshotJson(value, maxBytes);
    if (captured === null) {
        throw new TypeError('Snapshot exceeds its byte limit.');
    }
    const text = JSON.stringify(captured.value, sortedKeys, jsonIndentation);
    enforceSnapshotLimit(Buffer.byteLength(text), maxBytes);
    return { kind: 'text', text };
}

function captureBinarySnapshot(actual: Uint8Array, maxBytes: number): SnapshotPayload {
    if (!(actual instanceof Uint8Array)) {
        throw new TypeError('Binary snapshots require Uint8Array values.');
    }
    enforceSnapshotLimit(actual.byteLength, maxBytes);
    return persistBaselinePayload({ kind: 'binary', bytes: new Uint8Array(actual) });
}

function captureTextSnapshot(actual: string, maxBytes: number): SnapshotPayload {
    if (typeof actual !== 'string') {
        throw new TypeError('Text snapshots require string values.');
    }
    enforceSnapshotLimit(Buffer.byteLength(actual), maxBytes);
    return { kind: 'text', text: actual };
}

export function captureSnapshot(input: SnapshotInput, maxBytes: number): SnapshotPayload {
    if (input.kind === 'bytes') {
        return captureBinarySnapshot(input.actual, maxBytes);
    }
    if (input.kind === 'text') {
        return captureTextSnapshot(input.actual, maxBytes);
    }
    return captureJsonSnapshot(input.actual, maxBytes);
}

export function snapshotComparisonValue(payload: SnapshotPayload, format: SnapshotInput['kind']): unknown {
    if (format === 'bytes' !== (payload.kind === 'binary')) {
        throw new TypeError('Snapshot payload does not match its format.');
    }
    const restored = restoreBaselinePayload(payload);
    if (restored.kind === 'binary') {
        return new Uint8Array(restored.bytes);
    }
    if (format === 'value') {
        return JSON.parse(restored.text);
    }
    return restored.text;
}
