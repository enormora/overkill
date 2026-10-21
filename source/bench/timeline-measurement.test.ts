import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { attachmentFixture, attachmentWork, type AttachmentFixture } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import {
    wallClockMeasurement,
    cpuCalibration,
    moduleMeasurement,
    type BenchmarkTimelineEvent
} from '../packages/bench/bench.entry-point.ts';
import { timelineMeasurement, measurementTimelinePolicy } from './timeline-measurement.ts';
import { withBenchmarkTimeline } from './timeline-execution.ts';
import { sampleTimeline, timelineContext } from './timeline-context.ts';
import { rawMeasurement, calibratedMeasurement, resolveCalibratedMeasurement } from './calibrated-measurement.ts';
import { benchmarkTimelineReportSchema } from './timeline-schema.ts';

async function recordAuthoredEvents(scope: TestScope): Promise<void> {
    timelineContext.getStore()?.invocation('measured', 1);
    sampleTimeline.mark('<marker>');
    scope.assert.equal(
        sampleTimeline.span('value', function () {
            return 7;
        }),
        7
    );
    const first = sampleTimeline.span('first', async function () {
        return await Promise.resolve(1);
    });
    const second = sampleTimeline.span('second', async function () {
        return await Promise.resolve(2);
    });
    scope.assert.deepEqual(await Promise.all([ first, second ]), [ 1, 2 ]);
    scope.assert.throws(function () {
        sampleTimeline.span('failure', function () {
            throw new Error('authored failure');
        });
    }, { message: 'authored failure' });
    await timelineContext.getStore()?.retain();
}

async function captureAuthoredTimeline(scope: TestScope): Promise<AttachmentFixture> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        await fixture.execution.runAttempt(attachmentWork, { index: 0 }, async function attempt() {
            await withBenchmarkTimeline(
                timelineMeasurement(wallClockMeasurement(), { maximumEvents: 4096 }),
                recordAuthoredEvents.bind(null, scope)
            );
        });
    });
    return fixture;
}

function authoredEvents(fixture: AttachmentFixture): readonly BenchmarkTimelineEvent[] {
    const content = fixture.store.artifacts()[0]?.payload.content;
    if (content?.kind !== 'json') {
        throw new Error('Expected timeline evidence.');
    }
    return benchmarkTimelineReportSchema.parse(content.value).events.filter(function authored(event) {
        return event.source === 'authored';
    });
}

export const testNode = suite('benchmark timelines', [
    test('keeps authored operations synchronous and inert without capture', function (scope) {
        sampleTimeline.mark('disabled');
        scope.assert.equal(
            sampleTimeline.span('synchronous', function () {
                return 42;
            }),
            42
        );
        return scope.assert.collect();
    }),
    test('retains authored failures, synchronous values, and overlapping spans', async function (scope: TestScope) {
        const fixture = await captureAuthoredTimeline(scope);
        scope.assert.partialDeepEqual(authoredEvents(fixture), [
            { name: '<marker>', phase: 'measured', sample: 1 },
            { name: 'value', outcome: 'complete' },
            { name: 'first', outcome: 'complete' },
            { name: 'second', outcome: 'complete' },
            { name: 'failure', outcome: 'failed' }
        ]);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('bounds retention and reports unavailable attachment coordination', async function (scope: TestScope) {
        await withBenchmarkTimeline(timelineMeasurement(moduleMeasurement(), { maximumEvents: 2 }), async function () {
            sampleTimeline.mark('one');
            sampleTimeline.mark('two');
            sampleTimeline.mark('three');
            await timelineContext.getStore()?.retain();
            const recording = timelineContext.getStore();
            scope.require.defined(recording);
            scope.assert.partialDeepEqual(recording.evidence(), {
                events: 2,
                omitted: 1,
                status: 'omitted',
                reason: 'No runner attachment coordinator is active.'
            });
        });
        return scope.assert.collect();
    }),
    test('preserves timeline policies through raw and calibrated wrappers in either order', function (scope) {
        const policy = { maximumEvents: 4096 };
        const rules = { durationMicroseconds: { calibration: cpuCalibration(), scaling: 'proportional' as const } };
        const strategies = [
            rawMeasurement(timelineMeasurement(moduleMeasurement(), policy)),
            timelineMeasurement(rawMeasurement(moduleMeasurement()), policy),
            calibratedMeasurement(timelineMeasurement(moduleMeasurement(), policy), rules),
            timelineMeasurement(calibratedMeasurement(moduleMeasurement(), rules), policy)
        ];
        for (const strategy of strategies) {
            const resolved = resolveCalibratedMeasurement(strategy, new Set([ 'durationMicroseconds' ]));
            scope.assert.equal(resolved.measurement.mode, 'module');
            scope.assert.equal(measurementTimelinePolicy(resolved.measurement)?.maximumEvents, policy.maximumEvents);
        }
        scope.assert.throws(function () {
            timelineMeasurement(timelineMeasurement(wallClockMeasurement(), policy), policy);
        }, { type: TypeError });
        return scope.assert.collect();
    })
]);
