import { createHash } from 'node:crypto';
import { Random } from 'fast-check';
import { xoroshiro128plusFromState } from 'pure-rand/generator/xoroshiro128plus';
import { workIdentityKey } from '../engine/identity.ts';
import type { PropertyExecutionHost } from '../packages/engine/engine.entry-point.ts';

export function propertyRandom(host: PropertyExecutionHost, invocation: string): Random {
    const identity = JSON.stringify([ 'property-v1', host.seed.toString(), workIdentityKey(host.workId), invocation ]);
    const digest = createHash('sha256').update(identity).digest();
    const state = Array.from({ length: 4 }, function stateWord(_value, index) {
        return digest.readInt32LE(index * Int32Array.BYTES_PER_ELEMENT);
    });
    return new Random(xoroshiro128plusFromState(state));
}
