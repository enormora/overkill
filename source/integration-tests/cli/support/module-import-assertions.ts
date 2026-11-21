import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';

import { z } from 'zod/v4';

import type { RunResult } from '../../../packages/engine/engine.entry-point.ts';
import { readBenchmarkTimeline, type BenchmarkTimelineReport } from '../../../packages/bench/bench.entry-point.ts';
import { processEvidenceSchema } from '../../../bench/process-evidence.ts';
import { processEvidenceForWork } from '../../../bench/process-evidence-query.ts';
import { createBenchmarkHtmlReport } from '../../../reporters/benchmark-html-model.ts';
import { renderBenchmarkHtml } from '../../../reporters/benchmark-html-document.ts';

const childOutputSchema = z.strictObject({ pid: z.number().int().positive(), dependencyCount: z.literal(1) });

const freshProcessChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> => {
    const tested = result.perTest[0];
    if (tested === undefined || tested === null) {
        return check.defined(tested);
    }
    const entries = processEvidenceForWork(result, tested.workId).flatMap(function recordedProcesses(artifact) {
        if (artifact.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'json') {
            throw new Error('Expected process evidence.');
        }
        return processEvidenceSchema.parse(artifact.payload.content.value).entries;
    });
    const observed = entries.map(function processIdentity(entry) {
        if (entry.module === null) {
            return { pid: null, checks: check.defined(entry.module) };
        }
        if (entry.execution.status !== 'measured' || entry.execution.result.value.output.kind !== 'pipes') {
            throw new Error('Expected measured pipe evidence.');
        }
        return {
            pid: childOutputSchema.parse(JSON.parse(entry.execution.result.value.output.stdout.text)).pid,
            checks: check.equal(entry.module.failure, null)
        };
    });
    const identifiers = observed.flatMap(function recordedPids(entry) {
        return entry.pid === null ? [] : [ entry.pid ];
    });
    return check.group([
        check.equal(identifiers.length, 3),
        check.equal(new Set(identifiers).size, 3),
        ...observed.map(function retainedChecks(entry) {
            return entry.checks;
        }),
        ...identifiers.map(function exitedProcess(identifier) {
            return check.throws(function probeProcess() {
                process.kill(identifier, 0);
            }, { code: 'ESRCH' });
        })
    ]);
};
const samplePhasesChecks = (
    check: CompositeCheckBuilder<'assert'>,
    timeline: BenchmarkTimelineReport
): CompositeAssertionReturn<'assert'> => {
    const [ firstCheck, ...remainingChecks ] = ([ 'warmup', 'measured' ] as const).map((phase) => {
        const marks = timeline.events.filter(function prepared(event) {
            return event.phase === phase && event.name === 'prepared';
        });
        return check.group([
            check.deepEqual(
                marks.map(function sampleIndex(event) {
                    return event.sample;
                }),
                phase === 'warmup' ? [ 0 ] : [ 0, 1 ]
            ),
            check.equal(
                timeline
                    .events
                    .filter(function cleanup(event) {
                        return event.phase === phase && event.name === 'reset';
                    })
                    .length,
                marks.length
            )
        ]);
    });
    if (firstCheck === undefined) {
        throw new Error('Expected at least one recorded check.');
    }
    return check.group([ firstCheck, ...remainingChecks ]);
};

const htmlTimelineChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> => {
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
    return check.group([ check.includes(html, 'Benchmark timelines'), check.includes(html, 'authored import') ]);
};

const timelineChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> => {
    const tested = result.perTest[0];
    if (tested === undefined || tested === null) {
        return check.defined(tested);
    }
    const initialChecksBeforeNextAction = check.defined(tested);
    const timeline = readBenchmarkTimeline(result, tested);
    if (timeline === undefined || timeline === null) {
        return check.group([ initialChecksBeforeNextAction, check.defined(timeline) ]);
    }
    return check.group([
        initialChecksBeforeNextAction,
        check.defined(timeline),
        samplePhasesChecks(check.annotated('sample phases'), timeline),
        check.throws(function foreignWorkload() {
            readBenchmarkTimeline(result, {
                ...tested,
                workId: { ...tested.workId, workload: { name: 'foreign', params: {} } }
            });
        }, { message: 'Timeline artifact belongs to another workload, runtime, case, or attempt.' }),
        check.true(timeline.events.some(function authored(event) {
            return event.name === 'authored import';
        })),
        check.true(timeline.events.some(function childClock(event) {
            return event.clockDomain.startsWith('module:');
        })),
        htmlTimelineChecks(check.annotated('html timeline'), result)
    ]);
};

export const assertModuleBenchmark = defineCompositeAssertion({
    name: 'module benchmark',
    assert(check, result: RunResult) {
        const measured = result.perTest[0]?.benchmark;
        const outcome = check.group([
            check.deepEqual(result.runnerErrors, []),
            check.equal(result.summary.passed, 1)
        ]);
        if (measured === undefined || measured === null) {
            return check.group([ outcome, check.defined(measured) ]);
        }
        return check.group([
            outcome,
            check.partialDeepEqual(measured, { samples: 2, normalization: null }),
            check.equal(measured.budgets[0]?.decision, 'pass'),
            freshProcessChecks(check, result),
            timelineChecks(check, result)
        ]);
    }
});
export const assertFailedTimeline = defineCompositeAssertion({
    name: 'failed timeline',
    assert(check, result: RunResult) {
        const initialChecks = check.equal(result.summary.failed, 1);
        const tested = result.perTest[0];
        if (tested === undefined || tested === null) {
            return check.group([ initialChecks, check.defined(tested) ]);
        }
        const intermediateChecks = check.defined(tested);
        const timeline = readBenchmarkTimeline(result, tested);
        if (timeline === undefined || timeline === null) {
            return check.group([ initialChecks, intermediateChecks, check.defined(timeline) ]);
        }
        return check.group([
            initialChecks,
            intermediateChecks,
            check.defined(timeline),
            check.true(timeline.events.some(function failed(event) {
                return event.name === 'failed body' && event.outcome === 'failed';
            })),
            check.true(timeline.events.some(function cleaned(event) {
                return event.name === 'failure cleanup';
            })),
            check.true(timeline.events.some(function collected(event) {
                return event.name === 'forced GC';
            }))
        ]);
    }
});
