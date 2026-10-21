import { z } from 'zod/v4';
import type { TestScope } from '../../packages/test/test.entry-point.ts';
import type { RunResult } from '../../engine/run-result.ts';
import { readBenchmarkTimeline } from '../../packages/bench/bench.entry-point.ts';
import { processEvidenceSchema } from '../../bench/process-evidence.ts';
import { processEvidenceForWork } from '../../bench/process-evidence-query.ts';
import { createBenchmarkHtmlReport } from '../../reporters/benchmark-html-model.ts';
import { renderBenchmarkHtml } from '../../reporters/benchmark-html-document.ts';

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
}

function assertTimeline(scope: TestScope, result: RunResult): void {
    const tested = result.perTest[0];
    scope.require.defined(tested);
    const timeline = readBenchmarkTimeline(result, tested);
    scope.require.defined(timeline);
    scope.assert.true(timeline.events.some(function warmup(event) {
        return event.phase === 'warmup';
    }));
    scope.assert.true(timeline.events.some(function authored(event) {
        return event.name === 'authored import';
    }));
    scope.assert.true(timeline.events.some(function childClock(event) {
        return event.clockDomain.startsWith('module:');
    }));
    const html = renderBenchmarkHtml(createBenchmarkHtmlReport(result), '');
    scope.assert.includes(html, 'Benchmark timelines');
    scope.assert.includes(html, 'authored import');
}

export function assertModuleBenchmark(scope: TestScope, result: RunResult): void {
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.summary.passed, 1);
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
