export const benchAuthoringScript = `
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as bench from '@overkill-dev/bench';
import * as ordinary from '@overkill-dev/test';
import * as standard from '@overkill-dev/test/bench';
import { createRoot, createTestPlan, createWorkloadTestCase, execute } from '@overkill-dev/engine';
import { defineResource, withResource } from '@overkill-dev/test/resources';

const benchManifest = new URL('../../package.json', import.meta.resolve('@overkill-dev/bench'));
const manifest = JSON.parse(readFileSync(benchManifest, 'utf8'));
assert.deepEqual(Object.keys(bench).sort(), [
    'asyncMeasurementStrategy', 'availableMetric', 'benchmark',
    'defaultBenchmarkLifecyclePolicy', 'defaultRuntimeCooldownPolicy', 'defaultSamplingPolicy',
    'defineMacro', 'defineParameterizedTestBody', 'measurementStrategy', 'memoryCollector',
    'processCpuCollector', 'processMeasurement', 'processResourceCollector', 'runtimeHealthCollector', 'skippedTest',
    'suite', 'table', 'test', 'threadCpuCollector', 'unavailableMetric', 'wallClockMeasurement', 'workload'
]);
assert.deepEqual(Object.keys(standard).sort(), Object.keys(bench).sort());
assert.deepEqual(manifest.exports['.'], {
    import: './packages/bench/bench.entry-point.js',
    types: './packages/bench/bench.entry-point.d.ts'
});
assert.deepEqual(readdirSync(new URL('node_modules/@overkill-dev/', benchManifest)).sort(), [
    'engine', 'resources', 'run', 'simulation'
]);
assert.equal(Object.hasOwn(manifest, 'bin'), false);
assert.equal(Object.hasOwn(manifest.dependencies ?? {}, '@overkill-dev/test'), false);
const standardManifest = new URL('../../package.json', import.meta.resolve('@overkill-dev/test'));
const standardPackage = JSON.parse(readFileSync(standardManifest, 'utf8'));
const bundledBenchManifest = new URL('node_modules/@overkill-dev/bench/package.json', standardManifest);
const bundledBench = JSON.parse(readFileSync(bundledBenchManifest, 'utf8'));
assert.equal(bundledBench.name, '@overkill-dev/bench');
assert.equal(bundledBench.version, manifest.version);
assert.equal(bundledBench.version, standardPackage.version);

let calls = 0;
const rowBody = standard.defineParameterizedTestBody((scope, value) => {
    calls += 1;
    scope.assert.equal(value, 3);
    return scope.assert.collect();
});
const node = ordinary.suite('mixed', [
    standard.test({ title: 'parameterized', body: rowBody(3), annotations: { tags: ['bench'] } }),
    bench.suite('ordinary child', [ ordinary.test('fails', (scope) => {
        scope.assert.equal('actual', 'expected');
        return scope.assert.collect();
    }) ]),
    standard.table({ title: 'rows', cases: [2, 4], test(scope) {
        scope.assert.greaterThan(scope.parameters, 0);
        return scope.assert.collect();
    } }),
    bench.skippedTest('skips', 'unavailable')
]);
assert.equal(calls, 0);
const plan = createTestPlan(createRoot({ annotations: {}, children: [node], controls: {}, title: 'root' }));
assert.equal(plan.defined, 6);
assert.equal(plan.discoveredCases.length, 5);
assert.deepEqual(plan.orphans, []);
assert.equal(plan.discoveredCases[0].testFamily, null);
assert.deepEqual(plan.discoveredCases[0].annotations.tags, ['bench']);
const result = await execute(plan);
assert.equal(calls, 1);
assert.equal(result.summary.passed, 3);
assert.equal(result.summary.failed, 1);
assert.equal(result.summary.skipped, 1);
assert.equal(result.summary.defined, 6);
assert.deepEqual(result.runnerErrors, []);
let sampleCleanups = 0;
const measurementNode = standard.benchmark('measurement', {
    kind: 'runtime',
    workloads: [standard.workload('one', {size: 3})],
    measurement: standard.measurementStrategy([standard.threadCpuCollector()]),
    measure({sample, workload}) {
        sample.cleanup(() => { sampleCleanups += 1; });
        const measured = sample.measure(() => workload.parameters.size);
        return {size: measured.value, cpu: measured.metrics.threadCpuTotalMicroseconds};
    },
    diagnosticMetrics: ['cpu'],
    budgets: {one: {size: {minimum: 3, maximum: 3}}}
});
const measurementResult = await execute(createTestPlan(createRoot({
    annotations: {}, controls: {}, title: 'measurements', children: [measurementNode]
})));
assert.equal(measurementResult.summary.passed, 1);
assert.deepEqual(measurementResult.runnerErrors, []);
assert.equal(measurementResult.perTest[0].benchmark.samples, 128);
assert.equal(measurementResult.perTest[0].benchmark.lifecycle.warmup.samples, 32);
assert.equal(measurementResult.perTest[0].benchmark.lifecycle.warmup.metrics.size.count, 32);
assert.equal(measurementResult.perTest[0].benchmark.lifecycle.cleanup.callbacks, 160);
assert.equal(sampleCleanups, 160);
assert.equal(measurementResult.perTest[0].benchmark.metrics.cpu.provenance.scope, 'thread');
assert.equal(measurementResult.perTest[0].attempts[0].benchmark.status, 'complete');
const small = standard.workload('small', { packages: 5 });
let acquisitions = 0;
let disposedPackages = null;
const fixture = defineResource({
    name: 'fixture', scope: 'per-case', requirements: [],
    workload(parameters) {
        assert.equal(typeof parameters.packages, 'number');
        return { packages: parameters.packages };
    },
    acquire({workload}) { acquisitions += 1; return workload.parameters.packages; },
    dispose(handle, {workload}) { assert.equal(handle, workload.parameters.packages); disposedPackages = handle; }
});
const workloadNode = createWorkloadTestCase({
    annotations: {}, controls: {}, definitionLocations: [{kind: 'unknown'}], title: 'workload',
    workloads: [{id: small.id, parameters: small.parameters, body: withResource(fixture, (scope) => {
        scope.assert.equal(scope.resources.fixture, 5);
        return scope.assert.collect();
    })}]
});
const workloadPlan = createTestPlan(createRoot({
    annotations: {}, controls: {}, title: 'root', children: [workloadNode]
}));
assert.equal(workloadPlan.cases[0].workId.workload.name, 'small');
assert.equal(acquisitions, 0);
assert.deepEqual(workloadPlan.cases[0].workloadParameters, {packages: 5});
assert.equal((await execute(workloadPlan)).summary.passed, 1);
assert.equal(acquisitions, 1);
assert.equal(disposedPackages, 5);
for (const api of [bench, standard]) {
    for (const kind of ['pipes', 'pty']) {
        const processNode = api.benchmark('packaged process', {
            kind: 'startup', workloads: [api.workload('one', {})],
            measurement: api.processMeasurement({instrumentation: 'node'}),
            async measure({sample}) {
                const child = await sample.process({
                    command: [process.execPath, '-e', 'process.stdout.write("Ready "+Boolean(process.stdout.isTTY));process.exit(0)'],
                    cwd: process.cwd(), env: null,
                    io: kind === 'pipes' ? {kind} : {kind, name: 'xterm', columns: 80, rows: 24},
                    completion: {kind: 'exit', readiness: null, steps: [], expectedExitCodes: [0]}
                });
                assert.equal(child.metrics.processCpuTotalMicroseconds.availability, 'available');
                assert.equal(child.value.metadata.runtime, process.version);
                assert.equal(child.value.metadata.backend, kind);
                const output = child.value.output;
                assert.equal(output.kind, kind === 'pipes' ? 'pipes' : 'terminal');
                assert.equal(output.kind === 'pipes' ? output.stdout.text : output.terminal.text, 'Ready ' + (kind === 'pty'));
                return {durationMicroseconds: child.metrics.durationMicroseconds};
            }, diagnosticMetrics: [],
            budgets: {one: {durationMicroseconds: {maximum: 60000000, statistic: {kind: 'observed-maximum'}}}}
        }, {
            annotations: {}, controls: {},
            sampling: {...api.defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2},
            lifecycle: {garbageCollection: 'off', warmupSamples: 0, cooldown: {mode: 'off'}}
        });
        const processResult = await execute(createTestPlan(createRoot({
            annotations: {}, controls: {}, title: 'packaged processes', children: [processNode]
        })));
        assert.equal(processResult.summary.passed, 1, JSON.stringify(processResult.perTest));
        assert.deepEqual(processResult.runnerErrors, []);
    }
}
console.log('bench authoring passed');
`;

export const benchMacroScript = `
import assert from 'node:assert/strict';
import * as bench from '@overkill-dev/bench';
import * as ordinary from '@overkill-dev/test';
import * as standard from '@overkill-dev/test/bench';
import {
    captureSourceLocation, createRoot, createTestPlan, execute, resolveSourceLocation
} from '@overkill-dev/engine';

function failingBody(scope) {
    scope.assert.equal('actual', 'expected');
    return scope.assert.collect();
}
async function checkLocations(author, other) {
    const inner = author.defineMacro(() => other.test('fails', failingBody));
    const outer = other.defineMacro(() => author.suite('nested', [inner()]));
    const callSite = captureSourceLocation();
    const node = outer();
    const expected = resolveSourceLocation(callSite);
    const plan = createTestPlan(createRoot({ annotations: {}, children: [node], controls: {}, title: 'root' }));
    const definition = resolveSourceLocation(plan.discoveredCases[0].definitionLocations[0]);
    assert.equal(plan.discoveredCases[0].definitionLocations.length, 3);
    assert.equal(definition.file, expected.file);
    assert.equal(definition.line, expected.line + 1);
    const result = await execute(plan);
    const outcome = result.perTest[0].outcome;
    assert.equal(outcome.kind, 'fail');
    const failure = outcome.failures[0];
    assert.equal(failure.kind, 'assertion');
    assert.equal(failure.checks[0].sourceLocations[0].file, definition.file);
    assert.equal(failure.checks[0].sourceLocations[0].line, definition.line);
}
for (const author of [bench, ordinary, standard]) {
    for (const other of [bench, ordinary, standard]) {
        if (author === other) continue;
        await checkLocations(author, other);
        const broken = author.defineMacro(() => { throw new Error('factory failed'); });
        assert.throws(() => broken(), { message: 'factory failed' });
        assert.equal(other.test('outside macro', failingBody).definitionLocations.length, 1);
        const later = other.defineMacro(() => author.test('later', failingBody));
        assert.equal(later().definitionLocations.length, 2);
    }
}
console.log('bench macro locations passed');
`;

export const standardBenchConsumerConfigScript = `
import { defineConfig } from '@overkill-dev/test/config';

export const config = defineConfig({
    profiles: {
        microtest: {
            testFamily: 'microtest',
            execution: { processModel: 'in-process', scheduling: 'serial' }
        }
    }
});
`;

export const benchmarkSelectionConfigScript = `
import { defineConfig } from '@overkill-dev/test/config';

export const config = defineConfig({
    profiles: {
        benchmark: { testFamily: 'microtest' },
        startup: { testFamily: 'benchmark', files: { include: ['startup.bench.mjs'] } }
    }
});
`;

export const benchmarkCommandsScript = `
import assert from 'node:assert/strict';
import { createEngine } from '@overkill-dev/engine';
import { commandLineRunner, createNodeCommandLineRunner } from '@overkill-dev/run/command-line';

const cwd = process.argv[2];
const runRequest = {
    baselineUpdateMode: 'none', capabilityRestrictions: { mode: 'enabled' }, capture: 'buffered',
    coverage: false, debug: { mode: 'off', selectors: [] }, execution: { mode: 'profile-default' },
    measureProcessUsage: null, order: 'lexical', paths: [], profile: null,
    processBudgetOverrides: null, processUsageSamplingIntervalMilliseconds: null,
    seed: { value: 42n }, selection: { kind: 'all' }, shard: { index: 1, total: 1 },
    timingCollection: 'profile-default', verbose: false, workers: null
};
for (const runner of [commandLineRunner, createNodeCommandLineRunner({ defaultEngine: createEngine() })]) {
    for (const profile of [null, 'startup']) {
        const result = await runner.bench.runBenchmarks({
            configPath: null, cwd, runRequest: { ...runRequest, profile }
        });
        assert.equal(result.exitCode, 0);
        assert.equal(result.runResult.summary.passed, 4);
        assert.equal(result.runResult.summary.skipped, 1);
        assert.deepEqual(result.fallbackDiagnostics, []);
        const listed = await runner.bench.listBenchmarks({ configPath: null, cwd, listRequest: {
            order: 'lexical', paths: [], profile, seed: { value: 42n }, selection: { kind: 'all' },
            shard: { index: 1, total: 1 }, withLocations: false, withOrphans: true
        } });
        assert.equal(listed.exitCode, 0);
        assert.equal(listed.runResult, null);
        assert.deepEqual(listed.stdoutLines, [
            'order=lexical seed=42',
            'startup.bench.mjs',
            '  standard distribution',
            '    bench authoring',
            '      parameterized',
            '      rows',
            '        case 1 [{"kind":"number","value":2}]',
            '        case 2 [{"kind":"number","value":4}]',
            '      skips',
            '    composes with ordinary authoring',
            'Orphans',
            '  (none)'
        ]);
    }
    const rejected = await runner.bench.runBenchmarks({
        configPath: null, cwd, runRequest: { ...runRequest, profile: 'benchmark' }
    });
    assert.equal(rejected.exitCode, 3);
    assert.deepEqual(rejected.fallbackDiagnostics, [
        'Overkill argument error: Profile "benchmark" has testFamily "microtest". ' +
            'Benchmark commands require testFamily "benchmark".'
    ]);
}
console.log('benchmark selection passed');
`;

export const standardBenchConsumerScript = `
import assert from 'node:assert/strict';
import { suite, test } from '@overkill-dev/test';
import * as bench from '@overkill-dev/test/bench';

assert.deepEqual(Object.keys(bench).sort(), [
    'asyncMeasurementStrategy', 'availableMetric', 'benchmark',
    'defaultBenchmarkLifecyclePolicy', 'defaultRuntimeCooldownPolicy', 'defaultSamplingPolicy',
    'defineMacro', 'defineParameterizedTestBody', 'measurementStrategy', 'memoryCollector',
    'processCpuCollector', 'processMeasurement', 'processResourceCollector', 'runtimeHealthCollector', 'skippedTest',
    'suite', 'table', 'test', 'threadCpuCollector', 'unavailableMetric', 'wallClockMeasurement', 'workload'
]);
let calls = 0;
const body = bench.defineParameterizedTestBody((scope, value) => {
    calls += 1;
    scope.assert.equal(calls, 1);
    scope.assert.equal(value, 3);
    return scope.assert.collect();
});
const createCase = bench.defineMacro((value) => bench.test('parameterized', body(value)));
const benchmarkSuite = bench.suite('bench authoring', [
    createCase(3),
    bench.table({ title: 'rows', cases: [2, 4], test(scope) {
        scope.assert.greaterThan(scope.parameters, 0);
        return scope.assert.collect();
    } }),
    bench.skippedTest('skips', 'unavailable')
]);
assert.equal(calls, 0);
export const testNode = suite('standard distribution', [
    benchmarkSuite,
    test('composes with ordinary authoring', (scope) => {
        scope.assert.equal(benchmarkSuite.children.length, 3);
        return scope.assert.collect();
    })
]);
`;
