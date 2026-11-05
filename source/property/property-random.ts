import { createHash } from 'node:crypto';
import { Random } from 'fast-check';
import { xoroshiro128plusFromState } from 'pure-rand/generator/xoroshiro128plus';
import { workIdentityKey } from '../engine/identity.ts';
import type { PropertyExecutionHost } from '../packages/engine/engine.entry-point.ts';

function propertyDigest(host: PropertyExecutionHost, invocation: string): Buffer {
    const identity = JSON.stringify([ 'property-v1', host.seed.toString(), workIdentityKey(host.workId), invocation ]);
    return createHash('sha256').update(identity).digest();
}

export function propertySeed(host: PropertyExecutionHost, invocation: string): string {
    return BigInt(`0x${propertyDigest(host, invocation).toString('hex')}`).toString();
}

export function propertyRandom(host: PropertyExecutionHost, invocation: string): Random {
    const digest = propertyDigest(host, invocation);
    const state = Array.from({ length: 4 }, function stateWord(_value, index) {
        return digest.readInt32LE(index * Int32Array.BYTES_PER_ELEMENT);
    });
    return new Random(xoroshiro128plusFromState(state));
}
