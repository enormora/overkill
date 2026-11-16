import { createStoredValue, type StoredValue } from '../stored-value.ts';
import {
    prepareImplementationAssignments,
    withPreparedImplementationAssignments,
    type ImplementationAssignmentRequest,
    type PreparedImplementationAssignments
} from '../implementation-assignment.ts';
import type { ImplementationInputContext } from '../implementation-reference.ts';
import type { ResourceCheckSnapshot } from './resource-check-contract.ts';
import { resourceImplementationParticipants } from './resource-implementation-participants.ts';
import type { ResourceDependencies } from './resource-definition-shape.ts';
import type {
    ResourceSessionContract,
    ResourceSessionDisposalContext
} from './resource-definition-types.ts';

type ResourceSession<Context> = ResourceSessionContract<Context>;

type ReferenceSessionRequest<Context extends Readonly<Record<string, unknown>>> = {
    readonly finish: (
        session: Pick<ResourceSession<Context>, 'context' | 'disposeOnce' | 'resourceChecks'>
    ) => ResourceSession<Context>;
    readonly resources: ResourceDependencies;
    readonly context: ImplementationInputContext;
    readonly signal: AbortSignal;
    readonly start: () => Promise<ResourceSession<Context>>;
};
type SessionLifetime = { readonly kind: 'closed'; } | { readonly kind: 'failed'; readonly cause: unknown; };
type SessionReadiness<Context extends Readonly<Record<string, unknown>>> = {
    readonly checks: StoredValue<() => readonly ResourceCheckSnapshot[]>;
    readonly ready: PromiseWithResolvers<ResourceSession<Context>['context']>;
    readonly close: PromiseWithResolvers<ResourceSessionDisposalContext>;
};
type SessionAdmission = ImplementationAssignmentRequest & { readonly prepared: PreparedImplementationAssignments; };

async function observeSessionLifetime<Context extends Readonly<Record<string, unknown>>>(
    request: ReferenceSessionRequest<Context>,
    admission: SessionAdmission,
    readiness: SessionReadiness<Context>
): Promise<SessionLifetime> {
    try {
        await withPreparedImplementationAssignments(admission, async function startAndClose() {
            const session = await request.start();
            readiness.checks.write(session.resourceChecks);
            readiness.ready.resolve(session.context);
            await session.disposeOnce(await readiness.close.promise);
        });
        return { kind: 'closed' };
    } catch (error: unknown) {
        readiness.ready.reject(error);
        return { kind: 'failed', cause: error };
    } finally {
        readiness.close.resolve({ signal: request.signal });
    }
}

export async function startResourceReferenceSession<Context extends Readonly<Record<string, unknown>>>(
    request: ReferenceSessionRequest<Context>
): Promise<ResourceSession<Context>> {
    const participants = resourceImplementationParticipants(request.resources);
    if (participants.length === 0) {
        return await request.start();
    }
    const inputs = { participants, context: request.context, signal: request.signal };
    const admission = { ...inputs, prepared: await prepareImplementationAssignments(inputs) };
    const readiness = {
        checks: createStoredValue<() => readonly ResourceCheckSnapshot[]>(function emptyChecks() {
            return [];
        }),
        ready: Promise.withResolvers<ResourceSession<Context>['context']>(),
        close: Promise.withResolvers<ResourceSessionDisposalContext>()
    };
    const lifetime = observeSessionLifetime(request, admission, readiness);
    return request.finish({
        context: await readiness.ready.promise,
        resourceChecks() {
            return readiness.checks.read()();
        },
        async disposeOnce(disposal) {
            readiness.close.resolve(disposal);
            const result = await lifetime;
            if (result.kind === 'failed') {
                throw result.cause;
            }
        }
    });
}
