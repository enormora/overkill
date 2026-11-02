import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { propertyCorpusSnapshot, type PropertyExecutionHost } from '../engine/property-execution-host.ts';
import { serializeValue } from '../packages/engine/engine.entry-point.ts';
import { sourceLocationSchema } from '../engine/identity-schema.ts';
import { caseIdentityKey, runtimeIdentitiesKey, workIdentityKey } from '../engine/identity.ts';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/property-corpus.ts';
import type { PropertyFailureObservation } from '../engine/property-failure-evidence.ts';
import type { PropertyInvocationContext } from './property-execution-result.ts';

type WitnessTarget = Readonly<PropertyWitnessFile['target']>;
export function propertyWitnessTarget(identity: string): WitnessTarget {
    if (identity === 'declared-property') {
        return { kind: 'property-value' };
    }
    const stored: unknown = JSON.parse(identity);
    const keyed = z.tuple([ z.literal('key'), z.string().min(1) ]).safeParse(stored);
    if (keyed.success) {
        return { kind: 'forall', location: { kind: 'unknown' }, occurrence: 0, key: keyed.data[1] };
    }
    const [ location, occurrence ] = z.tuple([ z.string(), z.number().int().nonnegative() ]).parse(
        JSON.parse(identity)
    );
    return { kind: 'forall', location: sourceLocationSchema.parse(JSON.parse(location)), occurrence, key: null };
}

export function confirmedPropertyWitness(
    context: PropertyInvocationContext,
    observation: PropertyFailureObservation,
    failureIdentity: string | null
): PropertyWitnessFile | null {
    if (observation.capture.kind !== 'encoded' || failureIdentity === null) {
        return null;
    }
    const { host, identity } = context;
    const seedContext = JSON.stringify([ 'property-v1', host.seed.toString(), workIdentityKey(host.workId), identity ]);
    const seed = BigInt(`0x${createHash('sha256').update(seedContext).digest('hex')}`).toString();
    return propertyWitnessSchema.parse({
        version: 1,
        kind: 'property',
        producedBy: { library: '@overkill-dev/property', libraryVersion: 'unversioned-source' },
        case: host.workId.case,
        runtimes: Array.from(host.workId.runtimes),
        seed,
        target: propertyWitnessTarget(identity),
        counterexample: observation.capture.input,
        failureIdentity,
        shrinkPath: null
    });
}

export function explicitPropertyKey(invocation: unknown): string | null {
    if (typeof invocation !== 'object' || invocation === null || !Object.hasOwn(invocation, 'key')) {
        return null;
    }
    return z.string().trim().min(1).parse(Reflect.get(invocation, 'key'));
}

function witnessTargetIdentity(target: WitnessTarget): string {
    if (target.kind === 'property-value') {
        return 'declared-property';
    }
    return target.key === null
        ? JSON.stringify([ JSON.stringify(target.location), target.occurrence ])
        : JSON.stringify([ 'key', target.key ]);
}

export function samePropertyTarget(left: WitnessTarget, right: WitnessTarget): boolean {
    return witnessTargetIdentity(left) === witnessTargetIdentity(right);
}

export async function completePropertyTargets(host: PropertyExecutionHost, seen: ReadonlySet<string>): Promise<void> {
    const corpus = propertyCorpusSnapshot(host);
    function absent(entry: PropertyWitnessFile): boolean {
        const { target } = entry;
        const identity = witnessTargetIdentity(target);
        return caseIdentityKey(entry.case) === caseIdentityKey(host.workId.case) &&
            runtimeIdentitiesKey(entry.runtimes) === runtimeIdentitiesKey(host.workId.runtimes) && !seen.has(identity);
    }
    if (corpus.checkedIn.some(absent)) {
        throw new Error('Checked-in corpus invocation target was not reached.');
    }
    if (corpus.localCache.some(absent)) {
        const observation = {
            capture: { kind: 'unavailable' as const },
            input: serializeValue(undefined),
            failure: serializeValue(undefined)
        };
        await host.recordEvidence({
            confirmedWitness: null,
            shrinkStatus: null,
            identity: 'unreached-corpus-target',
            original: observation,
            retained: observation,
            diagnostics: [ { reason: 'Skipped incompatible local corpus invocation target.', observation: null } ]
        });
    }
}
