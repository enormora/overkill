import { workIdentityKey } from '../engine/identity.ts';
import type {
    ResourceCheckOwner,
    ResourceCheckInterval,
    ResourceCheckSnapshot,
    ResourceCheckWriter,
    ResourceCheckFinding,
    ResourceCheckCompleteness
} from '../resource-check-protocol.ts';

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
    stop: (cause: unknown, interval: ResourceCheckInterval) => void,
    owner: ResourceCheckOwner,
    publish: (snapshot: ResourceCheckSnapshot) => void
): ResourceCheckLedger {
    const slices = new Map<string, ResourceCheckSnapshot>();
    function key(interval: ResourceCheckInterval): string {
        return interval.kind === 'lifetime'
            ? 'lifetime'
            : `${workIdentityKey(interval.work)}:${interval.attempt.index}`;
    }
    function retain(interval: ResourceCheckInterval, snapshot: ResourceCheckSnapshot): void {
        slices.set(key(interval), snapshot);
        publish(snapshot);
    }
    function slice(interval: ResourceCheckInterval): ResourceCheckSnapshot {
        const identity = key(interval);
        const existing = slices.get(identity);
        if (existing !== undefined) {
            return existing;
        }
        const created: ResourceCheckSnapshot = Object.freeze({
            resource,
            owner,
            revision: 0,
            interval: structuredClone(interval),
            passing: 0,
            failures: Object.freeze([]),
            errors: Object.freeze([]),
            status: { kind: 'open' as const }
        });
        retain(interval, created);
        return created;
    }
    function error(interval: ResourceCheckInterval, target: string | null, cause: unknown): void {
        const current = slice(interval);
        const destination = current.status.kind === 'open' ? current : slice({ kind: 'lifetime' });
        retain(
            destination.interval,
            Object.freeze({
                ...destination,
                revision: destination.revision + 1,
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
    function retainLateFailure(
        target: string | null,
        finding: Extract<ResourceCheckFinding, { readonly kind: 'fail'; }>
    ): void {
        const destination = slice({ kind: 'lifetime' });
        retain(
            destination.interval,
            Object.freeze({
                ...destination,
                revision: destination.revision + 1,
                failures: Object.freeze([
                    ...destination.failures,
                    Object.freeze({ target, check: structuredClone(finding.check) })
                ]),
                status: { kind: 'incomplete' as const, reasons: [ 'Activity arrived after finalization.' ] }
            })
        );
    }
    const writer: ResourceCheckWriter = {
        record(interval, target, finding) {
            const current = slice(interval);
            if (current.status.kind !== 'open') {
                if (finding.kind === 'fail') {
                    retainLateFailure(target, finding);
                }
                error(
                    interval,
                    target,
                    new Error('Resource check arrived after finalization.', {
                        cause: { interval: structuredClone(interval), finding: structuredClone(finding) }
                    })
                );
                return;
            }
            retain(
                interval,
                Object.freeze({
                    ...current,
                    revision: current.revision + 1,
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
            retain(
                interval,
                Object.freeze({ ...current, revision: current.revision + 1, status: Object.freeze(status) })
            );
            return status;
        }
    };
}
