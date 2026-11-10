import type { ReadonlyDeep, JsonValue, Except } from 'type-fest';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { AttemptId, CaseId, RuntimeId, WorkloadId, WorkId } from './identity.ts';

export type RunArtifactScope = {
    readonly activeCases: readonly CaseId[];
    readonly case: CaseId;
    readonly confidence: 'active-case' | 'concurrent-active';
    readonly kind: 'case';
} | {
    readonly kind: 'run';
};

type RunArtifactBaseId = {
    readonly familyVariant: WorkId['familyVariant'];
    readonly runtimes: readonly RuntimeId[];
    readonly sequence: number;
    readonly subtype: 'adapter' | 'attachment' | 'coverage' | 'hedged-conflict' | 'log-capture' | 'witness';
    readonly workload: WorkloadId | null;
};

type CaseArtifactId = RunArtifactBaseId & {
    readonly attempt: AttemptId;
    readonly scope: Extract<RunArtifactScope, { readonly kind: 'case'; }>;
};

type RunScopedArtifactId = RunArtifactBaseId & {
    readonly attempt: null;
    readonly scope: { readonly kind: 'run'; };
};

export type RunArtifactId = CaseArtifactId | RunScopedArtifactId;

export type CapturedOutputArtifactPayload = {
    readonly byteLength: number;
    readonly capturedAtMicroseconds: number;
    readonly kind: 'captured-output';
    readonly stream: 'stderr' | 'stdout';
    readonly text: string;
    readonly truncated: boolean;
};

export type CapturedOutputArtifact = {
    readonly id: RunArtifactId & { readonly subtype: 'log-capture' | 'witness'; };
    readonly payload: CapturedOutputArtifactPayload;
    readonly source: 'boundary-captured' | 'native';
};

export type AdapterArtifact = {
    readonly id: RunArtifactId & { readonly subtype: 'adapter'; };
    readonly payload: { readonly kind: 'adapter'; readonly adapter: string; readonly facts: ReadonlyDeep<JsonValue>; };
    readonly source: 'native';
};

export function artifactIdentityProjection(id: RunArtifactId): Except<RunArtifactId, 'familyVariant'> | RunArtifactId {
    const { familyVariant, ...neutral } = id;
    return familyVariant === null ? neutral : id;
}

export function artifactReferenceKey(reference: unknown): string {
    if (typeof reference === 'object' && reference !== null && Reflect.get(reference, 'familyVariant') === null) {
        const entries = Object.entries(reference).filter(function retainedIdentityField([ key ]) {
            return key !== 'familyVariant';
        });
        return canonicalIdentityJson(Object.fromEntries(entries));
    }
    return canonicalIdentityJson(reference);
}
