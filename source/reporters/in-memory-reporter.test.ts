import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RunResult } from '../engine/run-result.ts';
import { resolveRootMetadata } from '../engine/metadata.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    createInMemoryReporter
} from './in-memory-reporter.ts';

const reportingContext = createReportingContext({ projectRoot: null });
const runStartEvent = {
    facts: {},
    kind: 'run-start',
    root: { metadata: resolveRootMetadata({}), title: 'root' },
    startedAt: '2026-07-15T00:00:00.000Z'
} as const;

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/in-memory-reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'in-memory real-time reporter records events and final result notification',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryRealTimeReporter();
                const runtimeReporter = reporter(reportingContext);
                const runResult: RunResult = runResultFactory.build();
                const { onFinish } = runtimeReporter;

                if (onFinish === null) {
                    throw new TypeError('Expected in-memory reporter to expose onFinish.');
                }

                await runtimeReporter.onEvent(runStartEvent);
                await onFinish(runResult);

                scope.assert.deepEqual(reporter.getRecordedEntries(), [
                    { event: runStartEvent, result: null, type: 'event' },
                    { event: null, result: runResult, type: 'finish' }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'in-memory final-result reporter records final results',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryFinalResultReporter();
                const runtimeReporter = reporter(reportingContext);
                const runResult: RunResult = runResultFactory.build();

                await runtimeReporter.onResult(runResult);

                scope.assert.deepEqual(reporter.getRecordedEntries(), [ {
                    event: null,
                    result: runResult,
                    type: 'result'
                } ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'in-memory configurable reporter creates a real-time reporter',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryReporter({ mode: 'real-time' });
                const runtimeReporter = reporter(reportingContext);
                const event = {
                    facts: {},
                    kind: 'run-start',
                    root: { metadata: resolveRootMetadata({}), title: 'root' },
                    startedAt: '2026-07-15T00:00:00.000Z'
                } as const;

                await runtimeReporter.onEvent(event);

                scope.assert.equal(runtimeReporter.kind, 'real-time');
                scope.assert.deepEqual(reporter.getRecordedEntries(), [ { event, result: null, type: 'event' } ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'in-memory configurable reporter creates a final-result reporter',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryReporter({ mode: 'final-result' });
                const runtimeReporter = reporter(reportingContext);
                const runResult: RunResult = runResultFactory.build();

                await runtimeReporter.onResult(runResult);

                scope.assert.equal(runtimeReporter.kind, 'final-result');
                scope.assert.deepEqual(reporter.getRecordedEntries(), [ {
                    event: null,
                    result: runResult,
                    type: 'result'
                } ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
