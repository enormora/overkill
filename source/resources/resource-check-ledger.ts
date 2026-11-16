import { workIdentityKey } from '../engine/identity.ts';
import type {
    ResourceCheckInterval,
    ResourceCheckSnapshot,
    ResourceCheckWriter,
    ResourceCheckCompleteness
} from './resource-check-contract.ts';

export type ResourceCheckLedger = {
    readonly writer: ResourceCheckWriter;
    readonly open: (interval: ResourceCheckInterval) => void;
    readonly snapshots: () => readonly ResourceCheckSnapshot[];
    readonly finalize: (
        interval: ResourceCheckInterval,
        completeness: ResourceCheckCompleteness
    ) => ResourceCheckCompleteness;
};
export function createResourceCheckLedger(
    resource: string,
    stop: (cause: unknown, interval: ResourceCheckInterval) => void
): ResourceCheckLedger {
    const slices = new Map<string, ResourceCheckSnapshot>();
    function key(interval: ResourceCheckInterval): string {
        return interval.kind === 'lifetime'
            ? 'lifetime'
            : `${workIdentityKey(interval.work)}:${interval.attempt.index}`;
    }
    function slice(interval: ResourceCheckInterval): ResourceCheckSnapshot {
        const identity = key(interval);
        const existing = slices.get(identity);
        if (existing !== undefined) {
            return existing;
        }
        const created: ResourceCheckSnapshot = Object.freeze({
            resource,
            interval: structuredClone(interval),
            passing: 0,
            failures: Object.freeze([]),
            errors: Object.freeze([]),
            status: { kind: 'open' as const }
        });
        slices.set(identity, created);
        return created;
    }
    function error(interval: ResourceCheckInterval, target: string | null, cause: unknown): void {
        const current = slice(interval);
        const destination = current.status.kind === 'open' ? current : slice({ kind: 'lifetime' });
        slices.set(
            key(destination.interval),
            Object.freeze({
                ...destination,
                errors: Object.freeze([
                    ...destination.errors,
                    Object.freeze({ interval: structuredClone(interval), target, cause })
                ]),
                status: destination.status.kind === 'open'
                    ? destination.status
                    : {
                        kind: 'incomplete' as const,
                        reasons: Object.freeze([ 'Activity arrived after finalization.' ])
                    }
            })
        );
    }
    const writer: ResourceCheckWriter = {
        record(interval, target, finding) {
            const current = slice(interval);
            if (current.status.kind !== 'open') {
                error(
                    interval,
                    target,
                    new Error('Resource check arrived after finalization.', {
                        cause: { interval: structuredClone(interval), finding: structuredClone(finding) }
                    })
                );
                return;
            }
            slices.set(
                key(interval),
                Object.freeze({
                    ...current,
                    passing: current.passing + (finding.kind === 'pass' ? 1 : 0),
                    failures: finding.kind === 'pass'
                        ? current.failures
                        : Object.freeze([
                            ...current.failures,
                            Object.freeze({ target, check: structuredClone(finding.check) })
                        ])
                })
            );
        },
        error,
        requestStop(interval, target, cause) {
            if (cause.kind === 'check') {
                writer.record(interval, target, { kind: 'fail', check: cause.check });
            } else {
                error(interval, target, cause.error);
            }
            stop(cause.kind === 'check' ? cause.check : cause.error, interval);
        }
    };
    return {
        writer,
        open(interval) {
            slice(interval);
        },
        snapshots() {
            return Object.freeze(Array.from(slices.values(), function copySnapshot(snapshot) {
                return Object.freeze({
                    ...snapshot,
                    interval: structuredClone(snapshot.interval),
                    status: structuredClone(snapshot.status),
                    failures: structuredClone(snapshot.failures),
                    errors: Object.freeze(snapshot.errors.map(function copyError(observationError) {
                        return Object.freeze({
                            ...observationError,
                            interval: structuredClone(observationError.interval)
                        });
                    }))
                });
            }));
        },
        finalize(interval, completeness) {
            const current = slice(interval);
            if (current.status.kind !== 'open') {
                return current.status;
            }
            const status: ResourceCheckCompleteness = current.errors.length === 0 ? completeness : {
                kind: 'incomplete',
                reasons: Object.freeze([ 'Observation errors were recorded.' ])
            };
            slices.set(key(interval), Object.freeze({ ...current, status: Object.freeze(status) }));
            return status;
        }
    };
}
