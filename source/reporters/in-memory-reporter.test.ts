import { suite, test } from '@overkill-dev/test';

import { resolveRootTestAnnotations } from '../engine/test-data.ts';
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
    root: { annotations: resolveRootTestAnnotations({}), title: 'root' },
    startedAt: '2026-07-15T00:00:00.000Z'
} as const;

export const testNode = suite('In memory reporter', [
    test(
        'in-memory real-time reporter records events and final result notification',
        async function (scope) {
            const reporter = createInMemoryRealTimeReporter();
            const runtimeReporter = reporter(reportingContext);
            const runResult = runResultFactory.build();
            const { onFinish } = runtimeReporter;

            if (onFinish === null) {
                throw new TypeError('Expected in-memory reporter to expose onFinish.');
            }

            await runtimeReporter.onEvent(runStartEvent);
            await onFinish({ context: { id: null, startedAt: null, facts: null }, result: runResult });

            scope.assert.deepEqual(reporter.getRecordedEntries(), [
                { event: runStartEvent, result: null, type: 'event' },
                { event: null, result: runResult, type: 'finish' }
            ]);

            return scope.assert.collect();
        }
    ),
    test('in-memory final-result reporter records final results', async function (scope) {
        const reporter = createInMemoryFinalResultReporter();
        const runtimeReporter = reporter(reportingContext);
        const runResult = runResultFactory.build();

        await runtimeReporter.onResult({
            context: {
                id: null,
                startedAt: null,
                facts: null
            },
            result: runResult
        });

        scope.assert.deepEqual(reporter.getRecordedEntries(), [ {
            event: null,
            result: runResult,
            type: 'result'
        } ]);

        return scope.assert.collect();
    }),
    test('in-memory configurable reporter creates a real-time reporter', async function (scope) {
        const reporter = createInMemoryReporter({ mode: 'real-time' });
        const runtimeReporter = reporter(reportingContext);
        const event = {
            facts: {},
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'root' },
            startedAt: '2026-07-15T00:00:00.000Z'
        } as const;

        await runtimeReporter.onEvent(event);

        scope.assert.equal(runtimeReporter.kind, 'real-time');
        scope.assert.deepEqual(reporter.getRecordedEntries(), [ { event, result: null, type: 'event' } ]);

        return scope.assert.collect();
    }),
    test('in-memory configurable reporter creates a final-result reporter', async function (scope) {
        const reporter = createInMemoryReporter({ mode: 'final-result' });
        const runtimeReporter = reporter(reportingContext);
        const runResult = runResultFactory.build();

        await runtimeReporter.onResult({
            context: {
                id: null,
                startedAt: null,
                facts: null
            },
            result: runResult
        });

        scope.assert.equal(runtimeReporter.kind, 'final-result');
        scope.assert.deepEqual(reporter.getRecordedEntries(), [ {
            event: null,
            result: runResult,
            type: 'result'
        } ]);

        return scope.assert.collect();
    })
]);
