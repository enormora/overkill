import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { snapshotWorkloadParameters } from './workload-parameters.ts';
import { snapshotWorkloadInput, readWorkloadId, isWorkloadRecord, type WorkloadParameters } from './workload-input.ts';
import type { WorkloadId } from './identity.ts';

export type WorkloadVariant<Body> = {
    readonly id: WorkloadId;
    readonly body: Body;
    readonly parameters: WorkloadParameters | null;
};

function readVariant<Body>(value: unknown, isBody: (value: unknown) => value is Body): WorkloadVariant<Body> {
    if (!isWorkloadRecord(value) || !isBody(value.body)) {
        throw new TypeError('Workload test cases require workload identities and body functions.');
    }
    const id = readWorkloadId(value.id);
    const parameters = Object.hasOwn(value, 'parameters')
        ? snapshotWorkloadInput({ id, parameters: snapshotWorkloadParameters(value.parameters) }).parameters
        : null;
    return Object.freeze({ body: value.body, id, parameters });
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
