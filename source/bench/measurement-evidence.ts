import { randomUUID } from 'node:crypto';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import { CaseRunnerError } from '../engine/run-result.ts';
import type { MeasurementEvidence, MeasurementInvocationEvidence } from '../engine/measurement-evidence.ts';
import type { BenchmarkScope } from '../engine/benchmark-node.ts';
import type { UncalibratedMeasurement } from './measurement-definition.ts';
import type { MeasurementContext } from './measurement-context.ts';
import type { MeasurementTarget } from './measurement-target.ts';

const maximumRetainedInvocations = 4096;

export type MeasurementRecording = {
    readonly begin: (phase: 'measured' | 'warmup') => MeasurementContext;
    readonly snapshot: () => MeasurementEvidence;
};
export function createMeasurementRecording(
    scope: Pick<BenchmarkScope, 'attemptId' | 'reportError' | 'workId'>,
    target: MeasurementTarget,
    strategy: UncalibratedMeasurement
): MeasurementRecording {
    const identity = {
        target: {
            name: target.identity.name,
            version: target.identity.version,
            scope: target.identity.scope,
            clock: target.identity.clock,
            semantics: target.identity.semantics
        },
        collectors: strategy.mode === 'sync' || strategy.mode === 'async'
            ? strategy.collectors.map(function collectorIdentity(collector) {
                return { name: collector.name, version: collector.version, metrics: collector.metrics };
            })
            : []
    };
    const execution = withRunnerInfrastructure(randomUUID);
    const invocations: MeasurementInvocationEvidence[] = [];
    const counts = { warmup: 0, measured: 0 };
    let omitted = 0;
    return {
        begin(phase) {
            const invocationTarget = strategy.mode === 'process' || strategy.mode === 'module'
                ? { ...target, identity: { ...target.identity, instance: withRunnerInfrastructure(randomUUID) } }
                : target;
            const invocation = { execution, work: scope.workId, attempt: scope.attemptId, phase, index: counts[phase] };
            counts[phase] += 1;
            const slot = invocations.length;
            const retained = slot < maximumRetainedInvocations;
            if (retained) {
                invocations.push({
                    invocation,
                    target: invocationTarget.identity,
                    collectors: [],
                    status: 'incomplete',
                    errors: [ 'Measurement did not finalize.' ],
                    durationMicroseconds: null,
                    lifecycleMicroseconds: null
                });
            } else {
                omitted += 1;
            }
            let finalized = false;
            return {
                invocation,
                target: invocationTarget,
                infrastructureError(cause) {
                    scope.reportError(
                        new CaseRunnerError('Collector lifecycle failed.', { subtype: 'measurement', cause })
                    );
                },
                record(evidence) {
                    if (finalized) {
                        throw new TypeError('Measurement invocation finalized more than once.');
                    }
                    finalized = true;
                    if (retained) {
                        invocations[slot] = evidence;
                    }
                }
            };
        },
        snapshot() {
            return { version: 1, identity, invocations: Array.from(invocations), omitted };
        }
    };
}
