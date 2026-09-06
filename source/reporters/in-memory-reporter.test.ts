import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RunResult } from '../engine/run-result.ts';
import { resolveRootMetadata } from '../engine/metadata.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    createInMemoryReporter
} from './in-memory-reporter.ts';

export const testSuite = createOverkillSuite({
    title: 'source/reporters/in-memory-reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'in-memory real-time reporter records events and final result notification',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryRealTimeReporter();
                const runResult: RunResult = runResultFactory.build();
                const event = {
                    facts: {},
                    kind: 'run-start',
                    root: { metadata: resolveRootMetadata({}), title: 'root' },
                    startedAt: '2026-07-15T00:00:00.000Z'
                } as const;
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected in-memory reporter to expose onFinish.');
                }

                await reporter.onEvent(event);
                await onFinish(runResult);

                scope.assert.deepEqual(reporter.getRecordedEntries(), [
                    { event, result: null, type: 'event' },
                    { event: null, result: runResult, type: 'finish' }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'in-memory final-result reporter records final results',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryFinalResultReporter();
                const runResult: RunResult = runResultFactory.build();

                await reporter.onResult(runResult);

                scope.assert.deepEqual(reporter.getRecordedEntries(), [ {
                    event: null,
                    result: runResult,
                    type: 'result'
                } ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'in-memory configurable reporter creates a real-time reporter',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryReporter({ mode: 'real-time' });
                const event = {
                    facts: {},
                    kind: 'run-start',
                    root: { metadata: resolveRootMetadata({}), title: 'root' },
                    startedAt: '2026-07-15T00:00:00.000Z'
                } as const;

                await reporter.onEvent(event);

                scope.assert.equal(reporter.kind, 'real-time');
                scope.assert.deepEqual(reporter.getRecordedEntries(), [ { event, result: null, type: 'event' } ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'in-memory configurable reporter creates a final-result reporter',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryReporter({ mode: 'final-result' });
                const runResult: RunResult = runResultFactory.build();

                await reporter.onResult(runResult);

                scope.assert.equal(reporter.kind, 'final-result');
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
