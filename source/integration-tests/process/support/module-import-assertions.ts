import type { TestScope } from '@overkill-dev/test';
import { z } from 'zod/v4';

import type { RunResult } from '../../../packages/engine/engine.entry-point.ts';
import { readBenchmarkTimeline, type BenchmarkTimelineReport } from '../../../packages/bench/bench.entry-point.ts';
import { processEvidenceSchema } from '../../../bench/process-evidence.ts';
import { processEvidenceForWork } from '../../../bench/process-evidence-query.ts';
import { createBenchmarkHtmlReport } from '../../../reporters/benchmark-html-model.ts';
import { renderBenchmarkHtml } from '../../../reporters/benchmark-html-document.ts';

const childOutputSchema = z.strictObject({ pid: z.number().int().positive(), dependencyCount: z.literal(1) });

function assertFreshProcesses(scope: TestScope, result: RunResult): void {
    const tested = result.perTest[0];
    scope.require.defined(tested);
    const identifiers = processEvidenceForWork(result, tested.workId).flatMap(function identities(artifact) {
        if (artifact.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'json') {
            throw new Error('Expected process evidence.');
        }
        return processEvidenceSchema.parse(artifact.payload.content.value).entries.map(function identity(entry) {
            scope.require.defined(entry.module);
            scope.assert.equal(entry.module.failure, null);
            if (entry.execution.status !== 'measured' || entry.execution.result.value.output.kind !== 'pipes') {
                throw new Error('Expected measured pipe evidence.');
            }
            return childOutputSchema.parse(JSON.parse(entry.execution.result.value.output.stdout.text)).pid;
        });
    });
    const unique = new Set(identifiers);
    scope.assert.equal(identifiers.length, 3);
    scope.assert.equal(unique.size, 3);
    for (const identifier of identifiers) {
        scope.assert.throws(function terminatedModule() {
            process.kill(identifier, 0);
        }, { code: 'ESRCH' });
    }
}

function assertSamplePhases(scope: TestScope, timeline: BenchmarkTimelineReport): void {
    for (const phase of [ 'warmup', 'measured' ] as const) {
        const marks = timeline.events.filter(function prepared(event) {
            return event.phase === phase && event.name === 'prepared';
        });
        scope.assert.deepEqual(
            marks.map(function sampleIndex(event) {
                return event.sample;
            }),
            phase === 'warmup' ? [ 0 ] : [ 0, 1 ]
        );
        scope.assert.equal(
            timeline
                .events
                .filter(function cleanup(event) {
                    return event.phase === phase && event.name === 'reset';
                })
                .length,
            marks.length
        );
    }
}

function assertHtmlTimeline(scope: TestScope, result: RunResult): void {
    const html = renderBenchmarkHtml(
        createBenchmarkHtmlReport({
            result,
            context: {
                id: null,
                startedAt: null,
                facts: null
            }
        }),
        ''
    );
    scope.assert.includes(html, 'Benchmark timelines');
    scope.assert.includes(html, 'authored import');
}

function assertTimeline(scope: TestScope, result: RunResult): void {
    const tested = result.perTest[0];
    scope.require.defined(tested);
    const timeline = readBenchmarkTimeline(result, tested);
    scope.require.defined(timeline);
    assertSamplePhases(scope, timeline);
    scope.assert.throws(function foreignWorkload() {
        readBenchmarkTimeline(result, {
            ...tested,
            workId: { ...tested.workId, workload: { name: 'foreign', params: {} } }
        });
    }, { message: 'Timeline artifact belongs to another workload, runtime, case, or attempt.' });
    scope.assert.true(timeline.events.some(function authored(event) {
        return event.name === 'authored import';
    }));
    scope.assert.true(timeline.events.some(function childClock(event) {
        return event.clockDomain.startsWith('module:');
    }));
    assertHtmlTimeline(scope, result);
}

export function assertModuleBenchmark(scope: TestScope, result: RunResult): void {
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.summary.passed, 1);
    const measured = result.perTest[0]?.benchmark;
    scope.require.defined(measured);
    scope.assert.partialDeepEqual(measured, { samples: 2, normalization: null });
    scope.assert.equal(measured.budgets[0]?.decision, 'pass');
    assertFreshProcesses(scope, result);
    assertTimeline(scope, result);
}

export function assertFailedTimeline(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.summary.failed, 1);
    const tested = result.perTest[0];
    scope.require.defined(tested);
    const timeline = readBenchmarkTimeline(result, tested);
    scope.require.defined(timeline);
    scope.assert.true(timeline.events.some(function failed(event) {
        return event.name === 'failed body' && event.outcome === 'failed';
    }));
    scope.assert.true(timeline.events.some(function cleaned(event) {
        return event.name === 'failure cleanup';
    }));
    scope.assert.true(timeline.events.some(function collected(event) {
        return event.name === 'forced GC';
    }));
}
