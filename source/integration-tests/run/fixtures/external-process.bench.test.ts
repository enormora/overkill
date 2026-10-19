import {
    benchmark, defaultSamplingPolicy, processMeasurement, suite, workload, type BenchmarkOptions
} from '../../../packages/bench/bench.entry-point.ts';

const options: BenchmarkOptions = {
    annotations: {}, controls: {}, sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 },
    lifecycle: { garbageCollection: 'off', warmupSamples: 1, cooldown: { mode: 'off' } }
};
const budgets = { one: { durationMicroseconds: { maximum: 60_000_000, statistic: { kind: 'observed-maximum' } } } } as const;

export const testNode = suite('external process benchmarks', [
    benchmark('pipe child probe', {
        kind: 'startup', workloads: [ workload('one', {}) ], measurement: processMeasurement({ instrumentation: 'node' }),
        async measure({ sample }) {
            const run = await sample.process({
                command: [ process.execPath, '-e', 'process.stdout.write(String(process.pid)); process.stderr.write("diagnostic"); process.exit(0)' ],
                cwd: process.cwd(), env: null, io: { kind: 'pipes' },
                completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
            });
            return { durationMicroseconds: run.metrics.durationMicroseconds, outputBytes: run.metrics.outputBytes };
        },
        diagnosticMetrics: [ 'outputBytes' ], budgets
    }, options),
    benchmark('terminal interaction', {
        kind: 'responsiveness', workloads: [ workload('one', {}) ], measurement: processMeasurement({ instrumentation: 'node' }),
        async measure({ sample }) {
            const run = await sample.process({
                command: [ process.execPath, '-e', 'process.stdout.write("Ready "+process.stdin.isTTY+" "+process.stdout.columns+" "+process.stdout.rows+"\\n"); process.stdin.on("data",()=>setImmediate(()=>process.stdout.write("Reply "+process.stdout.columns+" "+process.stdout.rows+"\\n")));' ],
                cwd: process.cwd(), env: null, io: { kind: 'pty', name: 'xterm-256color', columns: 80, rows: 24 },
                completion: {
                    kind: 'interaction', readiness: { stream: 'terminal', text: 'Ready true 80 24' },
                    steps: [
                        { kind: 'expect', marker: { stream: 'terminal', text: 'Ready true 80 24' } },
                        { kind: 'resize', columns: 100, rows: 30 },
                        { kind: 'interaction', name: 'reply', input: 'hello\r', marker: { stream: 'terminal', text: 'Reply 100 30' } }
                    ]
                }
            });
            return { durationMicroseconds: run.metrics.durationMicroseconds, startupMilliseconds: run.metrics.startupMilliseconds };
        },
        diagnosticMetrics: [ 'startupMilliseconds' ], budgets
    }, options)
]);
