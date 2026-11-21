import { suite, test } from '@overkill-dev/test';

import { preciseTimingReport, type RunTimingSpan } from '../engine/run-timings.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { facts } from '../test-support/run-record-session-fixture.ts';
import { mergeRecordSchema } from './merge-results-schema.ts';
import { recordedRunResult } from './run-record-result.ts';
import type { MergeSource } from './merge-results-input.ts';
import { mergedRunTimings } from './merged-run-timings.ts';

const cleanupSpan: RunTimingSpan = {
    durationMicroseconds: 20,
    kind: 'cleanup',
    label: null,
    processId: 'parent',
    resource: null,
    startOffsetMicroseconds: 1,
    startTimeUnixMicroseconds: 101,
    status: 'success',
    workerId: 'worker'
};

function source(id: string, span: RunTimingSpan): MergeSource {
    const precise = preciseTimingReport({
        aggregationMicroseconds: 2,
        recordingMicroseconds: 3,
        observationWindow: { startTimeUnixMicroseconds: 100, durationMicroseconds: 50 },
        slowestSpanLimit: 1,
        spanLimit: 0,
        spans: [ span ]
    });
    const result = runResultFactory.build({});
    return {
        path: id,
        record: mergeRecordSchema.parse({
            version: 1,
            kind: 'single',
            detail: 'detailed',
            status: 'completed',
            id,
            facts,
            identities: [],
            runtime: null,
            versions: { engine: null, node: '26', packages: {} },
            result: recordedRunResult({ ...result, timings: { ...result.timings, precise } })
        })
    };
}
export const testNode = suite('merged timing evidence', [
    test('preserves aggregate totals and slowest evidence from truncated shards', function (scope) {
        const { precise } = mergedRunTimings([ source('first', cleanupSpan), source('second', cleanupSpan) ]);
        if (precise === null) {
            throw new Error('Expected precise merged timing evidence.');
        }
        scope.assert.deepEqual(precise.aggregates, [ {
            kind: 'cleanup',
            count: 2,
            durationMicroseconds: 40
        } ]);
        scope.assert.equal(precise.droppedSpanCount, 2);
        scope.assert.equal(precise.truncated, true);
        scope.assert.equal(precise.overhead.aggregationMicroseconds, 4);
        scope.assert.deepEqual(
            precise.slowestSpans.map(function identity(span) {
                return span.processId;
            }),
            [ 'first/parent', 'second/parent' ]
        );
        scope.assert.deepEqual(
            precise.slowestSpans.map(function offset(span) {
                return span.startOffsetMicroseconds;
            }),
            [ null, null ]
        );
        return scope.assert.collect();
    }),
    test('preserves explicit labels and qualifies coordinator spans without workers', function (scope) {
        const span = { ...cleanupSpan, label: 'dispose database', processId: null, workerId: null };
        const { precise } = mergedRunTimings([ source('first', span) ]);
        if (precise === null) {
            throw new Error('Expected precise merged timing evidence.');
        }
        const qualifiedSpans: readonly RunTimingSpan[] = [ {
            ...span,
            label: 'first: dispose database',
            processId: 'first/coordinator',
            startOffsetMicroseconds: null
        } ];
        scope.assert.deepEqual(precise.slowestSpans, qualifiedSpans);
        return scope.assert.collect();
    })
]);
