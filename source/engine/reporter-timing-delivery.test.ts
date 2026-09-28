import { createDeterministicOverkillClock } from '../clock/overkill-clock.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    type InMemoryFinalResultReporter,
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { createEngine, type Engine } from './engine.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';
import { preciseTimingReport, type RunPreciseTimingReport } from './run-timings.ts';

function ignoreOutputLine(): void {
    return undefined;
}

function createTimingDeliveryEngine(): Engine {
    const wallClock = createDeterministicOverkillClock();

    return createEngine({
        execute: createExecute({
            asyncLeakDiagnostics: 'enabled',
            readActiveResourceTypes() {
                return [];
            },
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: ignoreOutputLine },
                stdout: { writeLine: ignoreOutputLine },
                wallClock
            }),
            wallClock
        }),
        wallClock
    });
}

function preciseTimings(): RunPreciseTimingReport {
    return preciseTimingReport({
        aggregationMicroseconds: 3,
        recordingMicroseconds: 4,
        slowestSpanLimit: 1,
        spanLimit: 1,
        spans: [
            {
                durationMicroseconds: 750_000,
                kind: 'config.load',
                label: 'overkill.config.ts',
                processId: '42',
                resource: null,
                startOffsetMicroseconds: 10,
                status: 'success',
                workerId: null
            },
            {
                durationMicroseconds: 600_000,
                kind: 'worker.ready',
                label: null,
                processId: '43',
                resource: null,
                startOffsetMicroseconds: null,
                status: 'failure',
                workerId: 'lane-1'
            }
        ]
    });
}

function realTimePreciseReports(reporter: InMemoryRealTimeReporter): readonly (RunPreciseTimingReport | null)[] {
    return reporter.getRecordedEntries().flatMap(function readPreciseTiming(entry) {
        if (entry.event?.kind === 'run-end') {
            return [ entry.event.result.timings.precise ];
        }

        return entry.type === 'finish' && entry.result !== null
            ? [ entry.result.timings.precise ]
            : [];
    });
}

function finalPreciseReports(reporter: InMemoryFinalResultReporter): readonly (RunPreciseTimingReport | null)[] {
    return reporter.getRecordedEntries().flatMap(function readPreciseTiming(entry) {
        return entry.result === null ? [] : [ entry.result.timings.precise ];
    });
}

async function executeWithPreciseTimings(
    engine: Engine,
    realTimeReporter: InMemoryRealTimeReporter,
    finalResultReporter: InMemoryFinalResultReporter,
    precise: RunPreciseTimingReport
): Promise<void> {
    const testPlan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        children: [ engine.createTestCase({
            annotations: {},
            body(scope) {
                scope.assert.true(true);
                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'passes'
        }) ],
        controls: {},
        title: 'root'
    }));

    await engine.execute(testPlan, {
        execution: { mode: 'serial-in-process' },
        async finalizeResult(result) {
            return {
                ...result,
                timings: { precise, summary: result.timings.summary }
            };
        },
        reporters: [ realTimeReporter, finalResultReporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/reporter-timing-delivery.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() delivers complete precise timings through both reporter lifecycles',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createTimingDeliveryEngine();
                const realTimeReporter = createInMemoryRealTimeReporter();
                const finalResultReporter = createInMemoryFinalResultReporter();
                const precise = preciseTimings();

                await executeWithPreciseTimings(engine, realTimeReporter, finalResultReporter, precise);

                const deliveredReports = [
                    ...realTimePreciseReports(realTimeReporter),
                    ...finalPreciseReports(finalResultReporter)
                ];

                scope.assert.equal(deliveredReports.length, 3);
                for (const deliveredReport of deliveredReports) {
                    scope.assert.equal(deliveredReport, precise);
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
