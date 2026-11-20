export const moduleBenchmarkScript = `
import { writeFileSync } from 'node:fs';
const coldSmokeModule = new URL('./cold-smoke.cjs', import.meta.url);
writeFileSync(coldSmokeModule, 'module.exports = () => { throw new Error("export invoked"); };');
const coldSmokeNode = bench.benchmark('cold package import', {
    kind: 'startup', workloads: [bench.workload('one', {})],
    measurement: bench.rawMeasurement(bench.timelineMeasurement(bench.moduleMeasurement(), {maximumEvents: 64})),
    async measure({sample}) {
        sample.timeline.mark('packed import');
        const imported = await sample.importModule({
            url: coldSmokeModule, cwd: process.cwd(), env: null, nodeArguments: []
        });
        return {durationMicroseconds: imported.metrics.durationMicroseconds};
    },
    diagnosticMetrics: [],
    budgets: {one: {durationMicroseconds: {maximum: 5000000, statistic: {kind: 'observed-maximum'}}}}
}, {
    annotations: {}, controls: {},
    lifecycle: {...bench.defaultBenchmarkLifecyclePolicy, warmupSamples: 0},
    sampling: {...bench.defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2}
});
const coldSmokeResult = await execute(createTestPlan(createRoot({
    annotations: {}, controls: {}, title: 'cold imports', children: [coldSmokeNode]
})));
assert.equal(coldSmokeResult.summary.passed, 1);
assert.deepEqual(coldSmokeResult.runnerErrors, []);
assert.equal(coldSmokeResult.perTest[0].benchmark.samples, 2);
`;
