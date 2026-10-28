import { createHash } from 'node:crypto';
import { uniformInt } from 'pure-rand/distribution/uniformInt';
import { workIdentityKey, type WorkId } from './identity.ts';
import { createSplitMix, type SplitMixGenerator } from './splitmix.ts';
import type { TestRandom } from './test-scope.ts';

export type CaseRandomContext = { readonly seed: bigint; readonly work: WorkId; };

const maximumByte = 255;
const uuidBytes = 16;
const uuidVersionIndex = 6;
const uuidVariantIndex = 8;
const uuidVersionRange = 16;
const uuidVersion = 0x40;
const uuidVariantRange = 64;
const uuidVariant = 0x80;
const uuidFirstSegmentLength = 8;
const uuidMiddleSegmentLength = 4;
const uuidLastSegmentLength = 12;
const uuidSegments = [
    uuidFirstSegmentLength,
    uuidMiddleSegmentLength,
    uuidMiddleSegmentLength,
    uuidMiddleSegmentLength,
    uuidLastSegmentLength
];

export function deriveCaseSeed(seed: bigint, work: WorkId): bigint {
    const identity = JSON.stringify([ 'case-seed-v1', seed.toString(), workIdentityKey(work) ]);
    return createHash('sha256').update(identity).digest().readBigUInt64BE();
}

function randomHandle(generator: SplitMixGenerator): TestRandom {
    function integer(minimum: number, maximum: number): number {
        if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum) {
            throw new RangeError('Random integer bounds must be ordered safe integers.');
        }
        return uniformInt(generator, minimum, maximum);
    }
    function bytes(length: number): Uint8Array {
        if (!Number.isSafeInteger(length) || length < 0) {
            throw new RangeError('Random byte length must be a nonnegative safe integer.');
        }
        return Uint8Array.from({ length }, function randomByte() {
            return integer(0, maximumByte);
        });
    }
    return {
        integer,
        bytes,
        pick(values) {
            if (values.length === 0) {
                throw new RangeError('Cannot pick from an empty collection.');
            }
            const index = integer(0, values.length - 1);
            const choice = values.slice(index, index + 1).values().next();
            if (choice.done === true) {
                throw new RangeError('Cannot pick from an empty collection.');
            }
            return choice.value;
        },
        uuid() {
            const value = Buffer.from(bytes(uuidBytes));
            value.writeUInt8(value.readUInt8(uuidVersionIndex) % uuidVersionRange + uuidVersion, uuidVersionIndex);
            value.writeUInt8(value.readUInt8(uuidVariantIndex) % uuidVariantRange + uuidVariant, uuidVariantIndex);
            const hex = value.toString('hex');
            let offset = 0;
            return uuidSegments
                .map(function uuidSegment(length) {
                    const start = offset;
                    offset += length;
                    return hex.slice(start, offset);
                })
                .join('-');
        },
        split() {
            return [ randomHandle(generator.split()), randomHandle(generator.split()) ];
        }
    };
}

export function createTestRandom(seed: bigint): TestRandom {
    return randomHandle(createSplitMix(seed));
}
