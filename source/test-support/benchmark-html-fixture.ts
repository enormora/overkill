import type { BenchmarkExecutionResult } from '../engine/benchmark-result.ts';
import type { RunResult, PerTestResult } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { createCaseId } from '../engine/identity.ts';
import { availableMetric } from '../bench/metric-reading.ts';
import { defaultSamplingPolicy } from '../bench/sampling-policy.ts';
import { runResultFactory } from './run-result-factory.ts';

function fixtureTest(result: RunResult): PerTestResult {
    const test = result.perTest[0];
    if (test === undefined) {
        throw new Error('Benchmark fixture requires one test.');
    }
    return test;
}
export function benchmarkHtmlFixture(title: string): RunResult {
    const id = createCaseId('fixture.bench.ts', [ 'benchmarks' ], title, null);
    const workId = { case: id, workload: { name: 'small', params: {} }, runtimes: [] };
    const base = runResultFactory.build({
        summary: { defined: 1, discovered: 1, planned: 1, passed: 1 },
        perTest: [ { id, workId, verdict: 'pass' } ]
    });
    const test = fixtureTest(base);
    const provenance = { collector: 'measure-return', scope: 'custom' as const, unit: 'milliseconds' };
    const values = Array.from({ length: 4 }, function observation(_value, index) {
        return index + 1;
    });
    const samples: RuntimeAttachmentArtifact = {
        id: {
            attempt: { index: 0 },
            scope: { kind: 'case', case: id, activeCases: [ id ], confidence: 'active-case' },
            runtimes: [],
            workload: workId.workload,
            sequence: 0,
            subtype: 'attachment'
        },
        source: 'native',
        payload: {
            kind: 'runtime-attachment',
            name: 'benchmark-samples',
            mediaType: 'application/json',
            capturedAtMicroseconds: 0,
            capture: 'opt-in',
            producer: { kind: 'case' },
            content: {
                kind: 'json',
                byteLength: 0,
                value: {
                    latency: values.map(function reading(value) {
                        return availableMetric(value, provenance);
                    })
                }
            }
        }
    };
    const benchmark: BenchmarkExecutionResult = {
        workload: workId.workload,
        policy: defaultSamplingPolicy,
        samples: values.length,
        status: 'complete',
        assumption: 'independent-stationary-observations',
        metrics: {
            latency: { count: 4, minimum: 1, maximum: 4, mean: 2.5, median: 2.5, provenance, unavailableReasons: [] }
        },
        budgets: [ {
            metric: 'latency',
            statistic: { kind: 'quantile', probability: 0.5 },
            minimum: null,
            maximum: 5,
            estimate: 2.5,
            interval: { lower: 1, upper: 4 },
            precise: true,
            decision: 'pass'
        } ],
        rawSamples: { status: 'recorded', reference: JSON.stringify(samples.id), reason: null }
    };
    return {
        ...base,
        artifacts: [ samples ],
        perTest: [ { ...test, benchmark, attempts: [ { ...test.attempts[0], benchmark } ] } ]
    };
}
