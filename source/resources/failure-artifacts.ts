import type { JsonValue, ReadonlyDeep } from 'type-fest';
import type { AttemptId, WorkId } from '../engine/identity.ts';
import type { RuntimeAttachmentArtifact, RuntimeAttachments } from '../engine/runtime-attachment.ts';
import type { AnyResourceDefinition, Awaitable } from './resource-definition-shape.ts';

export type SimulationWitnessInput = {
    readonly producedBy: { readonly library: string; readonly libraryVersion: string; };
    readonly simulation: { readonly name: string; readonly payload: ReadonlyDeep<JsonValue>; };
    readonly scenario: string;
    readonly seed: bigint | null;
    readonly runtimeSnapshot: ReadonlyDeep<JsonValue>;
    readonly faultConfiguration: ReadonlyDeep<JsonValue>;
};
export type SimulationWitnessArtifact = RuntimeAttachmentArtifact & {
    readonly id: RuntimeAttachmentArtifact['id'] & { readonly subtype: 'witness'; };
    readonly source: 'native';
};
export type FailureArtifactAttachments = RuntimeAttachments & {
    readonly witness: (input: SimulationWitnessInput) => Promise<SimulationWitnessArtifact>;
};
type FailureSubject = Pick<
    AnyResourceDefinition,
    'acquire' | 'dependencies' | 'dispose' | 'name' | 'requirements' | 'scenarios' | 'scope'
>;

type CaptureHandle<Resource extends FailureSubject> = {
    readonly handle: Awaited<ReturnType<Resource['acquire']>>;
    readonly resource: string;
    readonly scenarios: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
};
type AttemptCapture = {
    readonly kind: 'attempt';
    readonly work: WorkId;
    readonly attempt: AttemptId;
    readonly attachments: FailureArtifactAttachments;
};
type LifetimeCapture = { readonly kind: 'lifetime'; readonly attachments: RuntimeAttachments; };
type Capture = AttemptCapture | LifetimeCapture;
export type ResourceFailureCapture<Resource extends FailureSubject> = Capture & CaptureHandle<Resource>;

const preparationKey = Symbol.for('@overkill-dev/resource-failure-preparation/v1');

export function withFailureArtifacts<Resource extends FailureSubject>(
    resource: Resource,
    prepare: (capture: ResourceFailureCapture<Resource>) => Awaitable<void>
): Resource {
    const previous: unknown = Reflect.get(resource, preparationKey);
    return Object.freeze({
        ...resource,
        async [preparationKey](capture: ResourceFailureCapture<Resource>) {
            const callbacks = [
                async function preparePrevious(): Promise<void> {
                    if (typeof previous === 'function') {
                        await Reflect.apply(previous, undefined, [ capture ]);
                    }
                },
                async function prepareCurrent(): Promise<void> {
                    await prepare(capture);
                }
            ];
            const failures: unknown[] = [];
            for (const callback of callbacks) {
                const [ result ] = await Promise.allSettled([ callback() ]);
                if (result.status === 'rejected') {
                    failures.push(result.reason);
                }
            }
            if (failures.length === 1 && failures[0] instanceof Error) {
                throw failures[0];
            }
            if (failures.length > 0) {
                throw new AggregateError(failures, 'Resource failure artifact preparation failed.');
            }
        }
    });
}

export async function prepareResourceFailureArtifacts(
    resource: AnyResourceDefinition,
    capture: ResourceFailureCapture<AnyResourceDefinition>
): Promise<void> {
    const prepare: unknown = Reflect.get(resource, preparationKey);
    if (typeof prepare === 'function') {
        await Reflect.apply(prepare, undefined, [ capture ]);
    }
}
