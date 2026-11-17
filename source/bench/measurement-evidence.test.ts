import { suite, test } from '../packages/test/test.entry-point.ts';
import { currentMeasurementContext } from './measurement-context.ts';
import { createMeasurementRecording, type MeasurementRecording } from './measurement-evidence.ts';
import { resolveMeasurementTarget } from './measurement-target.ts';
import { processMeasurement } from './process-measurement.ts';
import { moduleMeasurement } from './module-measurement.ts';
import { wallClockMeasurement } from './measurement-strategy.ts';
import type { UncalibratedMeasurement } from './measurement-definition.ts';

function recordingFor(strategy: UncalibratedMeasurement): MeasurementRecording {
    const context = currentMeasurementContext();
    return createMeasurementRecording(
        {
            workId: context.invocation.work,
            attemptId: context.invocation.attempt,
            reportError() {
                return undefined;
            }
        },
        resolveMeasurementTarget(strategy, null),
        strategy
    );
}
export const testNode = suite('measurement evidence ownership', [
    test('assigns fresh external target instances to each invocation', function (scope) {
        for (const strategy of [ processMeasurement({ instrumentation: 'node' }), moduleMeasurement() ]) {
            const recording = recordingFor(strategy);
            const warmup = recording.begin('warmup');
            const measured = recording.begin('measured');
            scope.assert.notEqual(warmup.target.identity.instance, measured.target.identity.instance);
            scope.assert.equal(warmup.target.identity.scope, 'external-process');
            scope.assert.equal(measured.invocation.execution, warmup.invocation.execution);
            scope.assert.equal(measured.invocation.index, 0);
            scope.assert.equal(warmup.invocation.index, 0);
        }
        return scope.assert.collect();
    }),
    test('distinguishes external process instrumentation in comparison identity', function (scope) {
        const instrumented = recordingFor(processMeasurement({ instrumentation: 'node' })).snapshot();
        const raw = recordingFor(processMeasurement({ instrumentation: 'off' })).snapshot();
        scope.assert.notDeepEqual(instrumented.identity, raw.identity);
        scope.assert.equal(instrumented.identity.target.semantics['instrumentation'], 'node');
        scope.assert.equal(raw.identity.target.semantics['instrumentation'], 'off');
        return scope.assert.collect();
    }),
    test('bounds retained invocations and records omitted evidence', function (scope) {
        const recording = recordingFor(wallClockMeasurement());
        for (let index = 0; index < 4097; index += 1) {
            recording.begin('measured');
        }
        const evidence = recording.snapshot();
        scope.assert.equal(evidence.invocations.length, 4096);
        scope.assert.equal(evidence.omitted, 1);
        scope.assert.equal(evidence.invocations.at(-1)?.invocation.index, 4095);
        scope.assert.equal(evidence.invocations.at(-1)?.status, 'incomplete');
        return scope.assert.collect();
    })
]);
