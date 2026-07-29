import { createHash } from 'node:crypto';
import type { ByteDiffRange, Diff } from './diff-shape.ts';

const byteArrayDiffLimit = 100;
const binaryRangeLimit = 5;
const binaryRangeSize = 8;

function hashBytes(bytes: readonly number[]): string {
    return createHash('sha256').update(Uint8Array.from(bytes)).digest('hex');
}

function nextDifferentOffset(
    expected: readonly number[],
    actual: readonly number[],
    offset: number,
    length: number
): number {
    let nextOffset = offset;

    while (nextOffset < length && expected[nextOffset] === actual[nextOffset]) {
        nextOffset += 1;
    }

    return nextOffset;
}

function diffRange(
    expected: readonly number[],
    actual: readonly number[],
    offset: number,
    length: number
): ByteDiffRange {
    const rangeEnd = Math.min(length, offset + binaryRangeSize);

    return {
        actual: actual.slice(offset, rangeEnd),
        expected: expected.slice(offset, rangeEnd),
        offset
    };
}

function differingRanges(expected: readonly number[], actual: readonly number[]): readonly ByteDiffRange[] {
    const ranges: ByteDiffRange[] = [];
    const length = Math.max(expected.length, actual.length);
    let offset = 0;

    while (offset < length && ranges.length < binaryRangeLimit) {
        const rangeOffset = nextDifferentOffset(expected, actual, offset, length);

        if (rangeOffset < length) {
            ranges.push(diffRange(expected, actual, rangeOffset, length));
        }

        offset = rangeOffset + binaryRangeSize;
    }

    return ranges;
}

export function createBinaryDiff(expected: readonly number[], actual: readonly number[]): Diff {
    return {
        actualHash: hashBytes(actual),
        actualSize: actual.length,
        expectedHash: hashBytes(expected),
        expectedSize: expected.length,
        kind: 'binary',
        ranges: differingRanges(expected, actual)
    };
}

export function shouldUseBinarySummary(expected: readonly number[], actual: readonly number[]): boolean {
    return expected.length > byteArrayDiffLimit || actual.length > byteArrayDiffLimit;
}
