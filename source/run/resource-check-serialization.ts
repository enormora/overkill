import { z } from 'zod/v4';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue, type SerializedValue } from '../compare/serialized-value.ts';
import { serializedValueSchema } from '../compare/serialized-value-schema.ts';
import { resourceCheckSnapshotSchema } from '../engine/assertion-result-schema.ts';
import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import type { ResourceCheckFrame } from './resource-check-channel.ts';

export function serializeFailedCheck(check: FailedCheck, convert: (value: unknown) => SerializedValue): FailedCheck {
    if (check.kind === 'foreign') {
        const { message, name, stack, thrown } = check.error;
        return {
            ...check,
            error: {
                message,
                name,
                stack,
                thrown: Object.hasOwn(check.error, 'thrownEncoding') ? thrown : convert(thrown)
            }
        };
    }
    if (check.kind === 'composite') {
        const [ first, ...remaining ] = check.children;
        return {
            ...check,
            children: [
                serializeFailedCheck(first, convert),
                ...remaining.map(function recordChild(child) {
                    return serializeFailedCheck(child, convert);
                })
            ]
        };
    }
    return check;
}

export function convertResourceCheckSnapshot(
    snapshot: ResourceCheckSnapshot,
    convert: (value: unknown) => SerializedValue
): ResourceCheckSnapshot {
    return {
        ...snapshot,
        failures: snapshot.failures.map(function recordFinding(finding) {
            return { ...finding, check: serializeFailedCheck(finding.check, convert) };
        }),
        errors: snapshot.errors.map(function recordObservationError(error) {
            return { ...error, cause: convert(error.cause) };
        })
    };
}

const serializedSnapshotSchema = z.lazy(function resourceCheck() {
    return z.intersection(
        resourceCheckSnapshotSchema.transform(function parseSnapshot(snapshot) {
            return convertResourceCheckSnapshot(snapshot, function parseValue(value) {
                return serializedValueSchema.parse(value);
            });
        }),
        z.record(z.string(), z.json())
    );
});

export function serializeResourceCheckSnapshot(snapshot: ResourceCheckSnapshot): ResourceCheckSnapshot {
    return serializedSnapshotSchema.parse(convertResourceCheckSnapshot(snapshot, serializeValue));
}

type StopFrame = Extract<ResourceCheckFrame, { readonly kind: 'stop'; }>;

export function serializeResourceCheckStop(frame: StopFrame): StopFrame {
    return { ...frame, cause: serializeValue(frame.cause) };
}
