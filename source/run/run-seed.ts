import { randomBytes } from 'node:crypto';

const seedByteLength = 8;

export function createRandomRunSeed(): bigint {
    return randomBytes(seedByteLength).readBigUInt64BE();
}
