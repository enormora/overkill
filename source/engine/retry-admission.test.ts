import { table, suite } from '@overkill-dev/test';

import {
    defineReporter,
    type ReporterEvent,
    type DefinedReporter,
    type ProcessUsageSnapshot,
    type RunProcessUsageTracker
} from '../packages/engine/engine.entry-point.ts';

import { createTestEngine } from '../test-support/create-test-engine.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const schedulingCases = [ { mode: 'serial-in-process' }, {
    mode: 'concurrent-in-process',
    maxConcurrency: 1
} ] as const;

type ProcessLimitProbe = {
    readonly emit: () => void;
    readonly tracker: RunProcessUsageTracker;
};

function processLimitProbe(sampleAtStart: boolean): ProcessLimitProbe {
    const sample = {
        activeResourceCount: 0,
        activeResourceTypes: [],
        capturedAtMicroseconds: 0,
        javaScriptEngineHeapBytes: 0,
        residentSetBytes: 2
    };
    let recordSample: (sample: ProcessUsageSnapshot) => void = function () {
        return undefined;
    };
    return {
        emit() {
            recordSample(sample);
        },
        tracker: {
            start(onSample) {
                if (onSample === undefined) {
                    throw new Error('Resource supervision requires a sample observer.');
                }
                recordSample = onSample;
                if (sampleAtStart) {
                    onSample(sample);
                }
            },
            finish() {
                return {
                    activeResourceTypes: [],
                    end: sample,
                    start: sample,
                    sampleCount: 1,
                    peakActiveResourceCount: 0,
                    peakJavaScriptEngineHeapBytes: 0,
                    peakResidentSetBytes: 2,
                    peakResidentSetGrowthBytesPerSecond: 0
                };
            }
        }
    };
}

function matchesProcessTrigger(event: ReporterEvent, trigger: string): boolean {
    if (trigger === 'tracking-start') {
        return false;
    }
    if (trigger === 'retry-end') {
        return event.kind === 'test-end' && event.completion === 'retry';
    }
    return event.kind === 'test-start' && event.attempt === (trigger === 'initial-start' ? 0 : 1);
}

function processLimitReporter(probe: ProcessLimitProbe, trigger: string): DefinedReporter {
    return defineReporter(function () {
        return {
            name: 'process-admission',
            kind: 'real-time',
            sinks: [ { kind: 'memory' } ],
            dispose: null,
            onFinish: null,
            onEvent(event: ReporterEvent) {
                if (matchesProcessTrigger(event, trigger)) {
                    probe.emit();
                }
            }
        };
    });
}

function failRetryStart(event: ReporterEvent): void {
    if (event.kind === 'test-start' && event.attempt === 1) {
        process.emit('unhandledRejection', new Error('retry admission failed'), Promise.resolve());
    }
}

export const testNode = suite('Retry admission', [
    table({
        title: 'rejects invalid total attempt limits',
        cases: [ 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY ],
        caseTitle: String,
        async test(scope) {
            const maxAttempts = scope.parameters;

            const engine = createTestEngine();
            let runs = 0;
            const plan = engine.createTestPlan(engine.createRoot({
                annotations: {},
                controls: {},
                title: 'invalid policy',
                children: [ engine.createTestCase({
                    ...metadata,
                    title: 'case',
                    body(attemptScope) {
                        runs += 1;
                        attemptScope.assert.fail();
                        return attemptScope.assert.collect();
                    }
                }) ]
            }));
            await scope.assert.rejects(async function executeInvalidPolicy() {
                await engine.execute(plan, {
                    debug: { mode: 'off' },
                    execution: { mode: 'serial-in-process' },
                    reporters: [],
                    runFacts: {},
                    startedAt: '1970-01-01T00:00:00.000Z',
                    retryPolicy: { maxAttempts }
                });
            }, { message: 'Retry maxAttempts must be a positive safe integer.' });
            scope.assert.equal(runs, 0);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'reporting failures prevent retry body execution',
        cases: schedulingCases,
        caseTitle(execution) {
            return execution.mode;
        },
        async test(scope) {
            const execution = scope.parameters;

            const engine = createTestEngine();
            let runs = 0;
            const reporter = defineReporter(function () {
                return {
                    name: 'fatal-admission',
                    kind: 'real-time',
                    sinks: [ { kind: 'memory' } ],
                    dispose: null,
                    onFinish: null,
                    onEvent: failRetryStart
                };
            });
            const plan = engine.createTestPlan(engine.createRoot({
                annotations: {},
                controls: {},
                title: 'admission',
                children: [ engine.createTestCase({
                    ...metadata,
                    title: 'case',
                    body(attemptScope) {
                        runs += 1;
                        attemptScope.assert.fail();
                        return attemptScope.assert.collect();
                    }
                }) ]
            }));
            const result = await engine.execute(plan, {
                debug: { mode: 'off' },
                execution,
                reporters: [ reporter ],
                retryPolicy: { maxAttempts: 3 },
                runFacts: {},
                startedAt: '1970-01-01T00:00:00.000Z'
            });
            scope.assert.deepEqual([ runs, result.summary.crashed, result.perTest[0]?.attempts.length ], [
                1,
                1,
                2
            ]);
            scope.assert.equal(result.status, 'failed');
            return scope.assert.collect();
        }
    }),
    table({
        title: 'process exhaustion stops retries',
        cases: schedulingCases.flatMap(function processExecutionMode(execution) {
            return [ 'tracking-start', 'initial-start', 'retry-start', 'retry-end' ].map(
                function processTrigger(trigger) {
                    return { execution, trigger };
                }
            );
        }),
        caseTitle({ execution, trigger }) {
            return [ trigger, execution.mode ].map(String).join(', ');
        },
        async test(scope) {
            const engine = createTestEngine();
            const probe = processLimitProbe(scope.parameters.trigger === 'tracking-start');
            let runs = 0;
            const plan = engine.createTestPlan(engine.createRoot({
                annotations: {},
                controls: {},
                title: 'process limit',
                children: [ engine.createTestCase({
                    ...metadata,
                    title: 'case',
                    body(attemptScope) {
                        runs += 1;
                        attemptScope.assert.fail();
                        return attemptScope.assert.collect();
                    }
                }) ]
            }));
            const result = await engine.execute(plan, {
                debug: { mode: 'off' },
                execution: scope.parameters.execution,
                reporters: [ processLimitReporter(probe, scope.parameters.trigger) ],
                retryPolicy: { maxAttempts: 3 },
                runFacts: {},
                startedAt: '1970-01-01T00:00:00.000Z',
                processUsageTracker: probe.tracker,
                processBudgets: {
                    activeResourceCount: null,
                    javaScriptEngineHeapBytes: null,
                    residentSetBytes: 1,
                    residentSetGrowthBytesPerSecond: null
                }
            });
            scope.assert.equal(
                runs,
                [ 'initial-start', 'tracking-start' ].includes(scope.parameters.trigger) ? 0 : 1
            );
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.runnerErrors[0]?.subtype, 'process-exhaustion');
            scope.assert.equal(
                result
                    .perTest
                    .flatMap(function attempts(test) {
                        return test.attempts;
                    })
                    .length,
                {
                    'tracking-start': 0,
                    'initial-start': 1,
                    'retry-start': 2,
                    'retry-end': 1
                }[scope.parameters.trigger]
            );
            return scope.assert.collect();
        }
    })
]);
