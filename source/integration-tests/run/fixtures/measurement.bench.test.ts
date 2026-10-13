import { appendFile } from 'node:fs/promises';
import { benchmark, wallClockMeasurement, workload, type BenchmarkMeasureContext, type BenchmarkMetrics, type WorkloadParameters } from '../../../packages/bench/bench.entry-point.ts';
import { defineResource, defineRuntime, defineRuntimeMatrix, withResource, withRuntime } from '../../../packages/test/resources.entry-point.ts';

const fixture = defineResource({
    name: 'workload-fixture', scope: 'per-run', requirements: [],
    workload(parameters) {
        const size = parameters.size;
        if (typeof size !== 'number') { throw new TypeError('Fixture requires workload size.'); }
        return { size };
    },
    async acquire(context) {
        const size = context.workload?.parameters.size;
        if (typeof size !== 'number') { throw new TypeError('Fixture requires workload size.'); }
        await appendFile('target/measurement-lifecycle.txt', `acquire:${size}\n`);
        return { size };
    },
    async dispose(handle) { await appendFile('target/measurement-lifecycle.txt', `dispose:${handle.size}\n`); },
    serializeHandle(handle) { return { size: handle.size }; },
    deserializeHandle(payload) { return payload; }
});

const matrix = defineRuntimeMatrix({
    name: 'measurement-runtime',
    variants: {
        first: defineRuntime({ name: 'measurement-runtime', dimensions: { variant: 'first' }, requirements: [], resources: {} }),
        second: defineRuntime({ name: 'measurement-runtime', dimensions: { variant: 'second' }, requirements: [], resources: {} })
    }
});
type Context = BenchmarkMeasureContext<WorkloadParameters>;
const measure = withResource<typeof fixture, Context, BenchmarkMetrics>(fixture, (context) => {
    const measured = context.sample.measure(() => context.resources['workload-fixture'].size);
    return { size: measured.value, durationMicroseconds: measured.metrics.durationMicroseconds ?? 0 };
});

export const testNode = benchmark('measurement fixture', {
    kind: 'runtime', workloads: [ workload('small', { size: 1 }), workload('large', { size: 2 }) ],
    measurement: wallClockMeasurement(),
    measure: withRuntime<typeof matrix, Context, BenchmarkMetrics>(matrix, measure),
    diagnosticMetrics: [ 'durationMicroseconds' ],
    budgets: { small: { size: { minimum: 1, maximum: 1 } }, large: { size: { minimum: 2, maximum: 2 } } }
});
