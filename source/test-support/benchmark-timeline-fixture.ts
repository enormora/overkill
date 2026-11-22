import { defaultAttachmentLimits, type AttachmentLimits } from '../engine/runtime-attachment.ts';
import type { BenchmarkTimelineEvent } from '../packages/bench/bench.entry-point.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import { withBenchmarkTimeline } from '../bench/timeline-execution.ts';
import { timelineMeasurement, wallClockMeasurement } from '../packages/test/bench.entry-point.ts';
import { benchmarkTimelineReportSchema } from '../bench/timeline-schema.ts';
import { inlineAttachmentFixture, attachmentWork, type AttachmentFixture } from './attachment-fixture.ts';

export async function captureTimeline(
    limits: Partial<AttachmentLimits>,
    operation: () => Promise<void>
): Promise<AttachmentFixture> {
    const fixture = inlineAttachmentFixture({ ...defaultAttachmentLimits, ...limits }, [ attachmentWork ]);
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        await fixture.execution.runAttempt(attachmentWork, { index: 0 }, async function attempt() {
            await withBenchmarkTimeline(
                timelineMeasurement(wallClockMeasurement(), { maximumEvents: 4096 }),
                operation
            );
        });
    });
    return fixture;
}

export function authoredEvents(fixture: AttachmentFixture): readonly BenchmarkTimelineEvent[] {
    const content = fixture.store.artifacts()[0]?.payload.content;
    if (content?.kind !== 'json') {
        throw new Error('Expected timeline evidence.');
    }
    return benchmarkTimelineReportSchema.parse(content.value).events.filter(function authored(event) {
        return event.source === 'authored';
    });
}
