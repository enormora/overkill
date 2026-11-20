import { randomBytes } from 'node:crypto';
import { withRunnerInfrastructure } from '../execution-ownership.ts';

const seedByteLength = 8;

export function createRandomRunSeed(): bigint {
    return withRunnerInfrastructure(function drawRunSeed() {
        return randomBytes(seedByteLength).readBigUInt64BE();
    });
}
