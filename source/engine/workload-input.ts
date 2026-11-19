import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { WorkloadId } from './identity.ts';
import {
    snapshotWorkloadParameters,
    type WorkloadParameters as WorkloadParameterRecord
} from './workload-parameters.ts';

export type WorkloadParameters = WorkloadParameterRecord;

export type WorkloadInput = {
    readonly id: WorkloadId;
    readonly parameters: WorkloadParameters;
};

export function workloadParameterIdentity(parameters: WorkloadParameters): WorkloadId['params'] {
    return Object.freeze(Object.fromEntries(
        Object
            .entries(parameters)
            .map(function encodeParameter([ key, value ]): readonly [string, string] {
                return [ key.normalize('NFC'), canonicalIdentityJson(value) ];
            })
            .toSorted(function compareNames([ left ], [ right ]) {
                return left.localeCompare(right);
            })
    ));
}

export function isWorkloadRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readWorkloadName(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0 || /\p{Cc}/v.test(value)) {
        throw new TypeError('Workload identities require non-empty names without control characters.');
    }
    return value;
}

function readIdentityParameters(value: unknown): WorkloadId['params'] {
    if (!isWorkloadRecord(value)) {
        throw new TypeError('Workload identities require a string parameter record.');
    }
    const keys = new Set<string>();
    const entries = Object.entries(value).map(function readParameter([ key, parameter ]): readonly [string, string] {
        const canonicalKey = key.normalize('NFC');
        if (typeof parameter !== 'string' || keys.has(canonicalKey)) {
            throw new TypeError('Workload identity parameters must be strings with distinct canonical keys.');
        }
        keys.add(canonicalKey);
        return [ canonicalKey, parameter ];
    });
    return Object.freeze(Object.fromEntries(entries));
}

export function readWorkloadId(value: unknown): WorkloadId {
    if (!isWorkloadRecord(value)) {
        throw new TypeError('Workload identities require a name and string parameter record.');
    }
    return Object.freeze({ name: readWorkloadName(value.name), params: readIdentityParameters(value.params) });
}

export function snapshotWorkloadInput(input: WorkloadInput): WorkloadInput {
    const id = readWorkloadId(input.id);
    const parameters = snapshotWorkloadParameters(input.parameters);
    if (canonicalIdentityJson(workloadParameterIdentity(parameters)) !== canonicalIdentityJson(id.params)) {
        throw new TypeError(`Workload "${input.id.name}" parameters do not match its identity.`);
    }
    return Object.freeze({
        id,
        parameters
    });
}
