import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { WorkloadId } from './identity.ts';

type WorkloadVariant<Body> = {
    readonly id: WorkloadId;
    readonly body: Body;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readWorkloadName(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0 || /\p{Cc}/v.test(value)) {
        throw new TypeError('Workload identities require non-empty names without control characters.');
    }
    return value;
}

function readIdentityParameters(value: unknown): WorkloadId['params'] {
    if (!isRecord(value)) {
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

function readWorkloadId(value: unknown): WorkloadId {
    if (!isRecord(value)) {
        throw new TypeError('Workload identities require a name and string parameter record.');
    }
    return Object.freeze({ name: readWorkloadName(value.name), params: readIdentityParameters(value.params) });
}

function readVariant<Body>(value: unknown, isBody: (value: unknown) => value is Body): WorkloadVariant<Body> {
    if (!isRecord(value) || !isBody(value.body)) {
        throw new TypeError('Workload test cases require workload identities and body functions.');
    }
    return Object.freeze({ body: value.body, id: readWorkloadId(value.id) });
}

export function readWorkloadTestCaseVariants<Body>(
    value: unknown,
    isBody: (value: unknown) => value is Body
): NonEmptyReadonlyArray<WorkloadVariant<Body>> {
    if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError('Workload test cases require at least one workload.');
    }
    const names = new Set<string>();
    const variants = Array.from(value, function readDistinctVariant(entry: unknown) {
        const variant = readVariant(entry, isBody);
        const name = variant.id.name.normalize('NFC');
        if (names.has(name)) {
            throw new TypeError(`Duplicate workload name: ${variant.id.name}.`);
        }
        names.add(name);
        return variant;
    });
    const [ first, ...remaining ] = variants;
    if (first === undefined) {
        throw new TypeError('Workload test cases require at least one workload.');
    }
    return Object.freeze([ first, ...remaining ]);
}
