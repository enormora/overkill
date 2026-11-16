import {
    attachImplementationParticipants,
    type ImplementationCarrier,
    type ImplementationParticipant
} from '../../implementation-participant.ts';
import {
    resourceImplementationParticipants,
    type AnyResourceDefinition,
    type ResourceMap
} from '../resources/resources.entry-point.ts';
import { directResourceEntries, stepRuntimeGraphs, type ResourceWrapperAction } from './resource-wrapper-data.ts';

function actionResourceMaps(actions: readonly ResourceWrapperAction[]): readonly ResourceMap[] {
    const direct = Object.fromEntries(
        directResourceEntries(actions).map(function entry({ key, resource }) {
            return [ key, resource ];
        })
    );
    return [
        direct,
        ...stepRuntimeGraphs(actions).flatMap(function runtimeResources(graph) {
            if (graph.kind === 'composed-runtimes') {
                throw new TypeError('Implementation preparation requires flattened runtime graphs.');
            }
            return graph.kind === 'runtime-matrix'
                ? Object.values(graph.variants).map(function resources(variant) {
                    return variant.runtime.resources;
                })
                : [ graph.resources ];
        })
    ];
}

export function attachResourceImplementations<Body extends ImplementationCarrier>(
    body: Body,
    actions: readonly ResourceWrapperAction[]
): Body {
    const participants = new Map<string, ImplementationParticipant>();
    for (const resources of actionResourceMaps(actions)) {
        for (const participant of resourceImplementationParticipants(resources)) {
            participants.set(participant.key, participant);
        }
    }
    return attachImplementationParticipants(body, Array.from(participants.values()));
}

export function resourceHandleTransport(resource: AnyResourceDefinition): 'local' | 'projected' {
    const referenced = resource.acquire === null && resource.implementation.consumer !== null;
    const inline = typeof resource.serializeHandle === 'function' && typeof resource.deserializeHandle === 'function';
    return referenced || inline ? 'projected' : 'local';
}
