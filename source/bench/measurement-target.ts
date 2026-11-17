import { threadId } from 'node:worker_threads';
import { z } from 'zod/v4';
import { CaseRunnerError } from '../engine/run-result.ts';
import type { BenchmarkGarbageCollectionCapability } from '../engine/benchmark-garbage-collection.ts';
import type { BenchmarkCooldownPolicy, BenchmarkCooldownResult } from '../engine/benchmark-result.ts';
import type { MeasurementTargetIdentity } from '../engine/measurement-evidence.ts';
import { microsecondsPerMillisecond } from './measurement-units.ts';
import type { AsyncMeasurementStrategy, MeasurementStrategy, CollectorContext } from './measurement-types.ts';
import { createRuntimeCooldownDependencies, settleBenchmarkRuntime } from './benchmark-runtime-cooldown.ts';

type TargetCapability<Operation> = { readonly kind: 'available'; readonly run: Operation; } | {
    readonly kind: 'unavailable';
    readonly reason: string;
};
export type MeasurementTarget = {
    readonly identity: MeasurementTargetIdentity;
    readonly normalization: 'node-cpu' | 'raw';
    readonly nowMicroseconds: () => number;
    readonly garbageCollection: TargetCapability<(signal: AbortSignal) => Promise<void> | void>;
    readonly cooldown: TargetCapability<
        (
            policy: Extract<BenchmarkCooldownPolicy, { readonly mode: 'runtime'; }>,
            signal: AbortSignal,
            previous: Extract<BenchmarkCooldownResult, { readonly mode: 'runtime'; }>
        ) => Promise<{ readonly evidence: BenchmarkCooldownResult; readonly error: Error | null; }>
    >;
};
export type TargetedMeasurement<Strategy> = Strategy & { readonly target: MeasurementTarget; };
export function withMeasurementTarget<Strategy extends AsyncMeasurementStrategy | MeasurementStrategy>(
    target: MeasurementTarget,
    strategy: Strategy
): TargetedMeasurement<Strategy> {
    if (target.identity.name.trim().length === 0 || target.identity.clock.trim().length === 0) {
        throw new TypeError('Measurement targets require a name and clock domain.');
    }
    const targeted = { ...strategy, target };
    Object.freeze(targeted);
    return targeted;
}
const targetSchema = z.custom<MeasurementTarget>(function measurementTarget(value) {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'nowMicroseconds') === 'function';
});
export function readMeasurementTarget(strategy: Readonly<Record<string, unknown>>): MeasurementTarget | null {
    return Object.hasOwn(strategy, 'target') ? targetSchema.parse(Reflect.get(strategy, 'target')) : null;
}
function executingMeasurementTarget(capability: BenchmarkGarbageCollectionCapability): MeasurementTarget {
    return {
        identity: {
            name: 'node',
            version: process.versions.node,
            scope: 'executing-runtime',
            semantics: {},
            clock: 'node-monotonic',
            instance: `${process.pid}:${threadId}`,
            document: null
        },
        normalization: 'node-cpu',
        nowMicroseconds() {
            return Number(process.hrtime.bigint()) / microsecondsPerMillisecond;
        },
        garbageCollection: capability.kind === 'unavailable' ? capability : {
            kind: 'available',
            run(signal) {
                signal.throwIfAborted();
                capability.collect();
            }
        },
        cooldown: {
            kind: 'available',
            async run(policy, signal, previous) {
                return await settleBenchmarkRuntime(policy, signal, previous, createRuntimeCooldownDependencies());
            }
        }
    };
}
export function defaultMeasurementTarget(): MeasurementTarget {
    return executingMeasurementTarget({
        kind: 'unavailable',
        reason: 'Forced GC requires a runner-granted capability.'
    });
}

function processMeasurementTarget(
    mode: 'module' | 'process',
    semantics: Readonly<Record<string, string>>
): MeasurementTarget {
    const target = defaultMeasurementTarget();
    const reason = 'The external measured process does not expose target settling or GC capabilities.';
    return {
        ...target,
        identity: {
            ...target.identity,
            name: mode,
            semantics,
            scope: 'external-process',
            clock: mode === 'module' ? 'module-runtime' : 'process-lifetime'
        },
        garbageCollection: { kind: 'unavailable', reason },
        cooldown: { kind: 'unavailable', reason }
    };
}

export function resolveMeasurementTarget(
    measurement: Readonly<Record<string, unknown>>,
    capability: BenchmarkGarbageCollectionCapability | null
): MeasurementTarget {
    const mode: unknown = Reflect.get(measurement, 'mode');
    if (mode === 'process' || mode === 'module') {
        const semantics = mode === 'process'
            ? { instrumentation: z.enum([ 'node', 'off' ]).parse(Reflect.get(measurement, 'instrumentation')) }
            : {};
        return processMeasurementTarget(mode, semantics);
    }
    const garbageCollection = capability ??
        { kind: 'unavailable' as const, reason: 'Forced GC requires supervised or hosted benchmark execution.' };
    return readMeasurementTarget(measurement) ?? executingMeasurementTarget(garbageCollection);
}
export function validateTargetCooldown(target: MeasurementTarget, policy: BenchmarkCooldownPolicy): void {
    if (policy.mode !== 'off' && target.cooldown.kind === 'unavailable') {
        throw new CaseRunnerError(target.cooldown.reason, { subtype: 'measurement', cause: null });
    }
}

export function validateExecutingMeasurementTarget(context: CollectorContext): void {
    if (context.target.scope !== 'executing-runtime' || context.target.instance !== `${process.pid}:${threadId}`) {
        throw new TypeError('Node collectors require the executing runtime as their measured target.');
    }
}
