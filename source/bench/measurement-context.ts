import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import type { MeasurementInvocation, MeasurementInvocationEvidence } from '../engine/measurement-evidence.ts';
import { defaultMeasurementTarget, readMeasurementTarget, type MeasurementTarget } from './measurement-target.ts';

export type MeasurementContext = {
    readonly invocation: MeasurementInvocation;
    readonly target: MeasurementTarget;
    readonly infrastructureError: (cause: unknown) => void;
    readonly record: (evidence: MeasurementInvocationEvidence) => void;
};
export const measurementContext = new AsyncLocalStorage<MeasurementContext>();
export function currentMeasurementContext(): MeasurementContext {
    return measurementContext.getStore() ?? {
        invocation: {
            execution: withRunnerInfrastructure(randomUUID),
            work: {
                case: { file: null, suite: [], title: 'measurement', params: null },
                runtimes: [],
                workload: null,
                familyVariant: null
            },
            attempt: { index: 0 },
            phase: 'measured',
            index: 0
        },
        target: defaultMeasurementTarget(),
        infrastructureError() {
            return undefined;
        },
        record() {
            return undefined;
        }
    };
}

export function measurementContextFor(strategy: Readonly<Record<string, unknown>>): MeasurementContext {
    const current = currentMeasurementContext();
    return { ...current, target: readMeasurementTarget(strategy) ?? current.target };
}
