import type { UncalibratedMeasurement } from './measurement-definition.ts';
import { createTimelineRecording } from './timeline-recording.ts';
import { timelineContext } from './timeline-context.ts';
import { measurementTimelinePolicy } from './timeline-measurement.ts';

export async function withBenchmarkTimeline<Value>(
    measurement: UncalibratedMeasurement,
    operation: () => Promise<Value>
): Promise<Value> {
    const policy = measurementTimelinePolicy(measurement);
    if (policy === null) {
        return await operation();
    }
    using disposal = new DisposableStack();
    const recording = createTimelineRecording(policy);
    disposal.defer(recording.close);
    return await timelineContext.run(recording, operation);
}
