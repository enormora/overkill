import { AsyncLocalStorage } from 'node:async_hooks';
import type { AttemptId, WorkId } from '../engine/identity.ts';
import type { FailureArtifactCondition, RuntimeAttachments } from '../engine/runtime-attachment.ts';
import { preparedResourceAttachments, resourceAttachments } from './attachment-context.ts';

export type ResourceFailureContext = {
    readonly name: string;
    readonly condition: FailureArtifactCondition;
};
const contextKey = Symbol.for('@overkill-dev/resource-failure-context/v1');
type ResourceFailureStorage = Readonly<AsyncLocalStorage<ResourceFailureContext>>;
function isResourceFailureStorage(value: unknown): value is ResourceFailureStorage {
    return value instanceof AsyncLocalStorage;
}
function sharedResourceFailureContext(): ResourceFailureStorage {
    const existing: unknown = Reflect.get(globalThis, contextKey);
    if (isResourceFailureStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<ResourceFailureContext>();
    Object.defineProperty(globalThis, contextKey, { value: created });
    return created;
}
const resourceFailureContext = sharedResourceFailureContext();

export function currentResourceFailureContext(): ResourceFailureContext | null {
    return resourceFailureContext.getStore() ?? null;
}

export function resourceFailureAttachments(
    context: ResourceFailureContext,
    source: 'boundary-captured' | 'instrumented'
): RuntimeAttachments | null {
    return preparedResourceAttachments(context.name, context.condition, source, 'attachment');
}

export function attemptFailureContext(name: string, work: WorkId, attempt: AttemptId): ResourceFailureContext {
    return { name, condition: { kind: 'attempt', work, attempt } };
}

export async function runWithResourceFailureContext<Value>(
    context: ResourceFailureContext,
    run: (attachments: RuntimeAttachments) => Promise<Value>
): Promise<Value> {
    return await resourceFailureContext.run(context, run, resourceAttachments(context.name));
}

type AttemptScope = Readonly<Record<string, unknown>>;
type AttemptScopeRegistry = WeakMap<AttemptScope, { readonly work: WorkId; readonly attempt: AttemptId; }>;
const scopeRegistryKey = Symbol.for('@overkill-dev/transcript-attempt-scopes/v1');
function isAttemptScopeRegistry(value: unknown): value is AttemptScopeRegistry {
    return value instanceof WeakMap;
}
function sharedAttemptScopes(): AttemptScopeRegistry {
    const existing: unknown = Reflect.get(globalThis, scopeRegistryKey);
    if (isAttemptScopeRegistry(existing)) {
        return existing;
    }
    const created: AttemptScopeRegistry = new WeakMap();
    Object.defineProperty(globalThis, scopeRegistryKey, { value: created });
    return created;
}
const attemptScopes = sharedAttemptScopes();

export function createTranscriptAttemptScope(work: WorkId, attempt: AttemptId): AttemptScope {
    const scope = Object.freeze({ work, attempt });
    attemptScopes.set(scope, { work, attempt });
    return scope;
}

export function transcriptAttempt(
    scope: AttemptScope | null
): { readonly work: WorkId; readonly attempt: AttemptId; } | null {
    return scope === null ? null : attemptScopes.get(scope) ?? null;
}
