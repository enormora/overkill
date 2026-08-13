import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { ReporterDispatcher, ReporterEvent } from './reporter.ts';
import { createReporterEventQueue } from './reporter-event-queue.ts';

type RejectingDispatcher = {
    readonly dispatcher: ReporterDispatcher;
    readonly events: () => readonly ReporterEvent[];
};

function createRejectingDispatcher(): RejectingDispatcher {
    const events: ReporterEvent[] = [];

    return {
        dispatcher: {
            async disposeReporters() {
                return [];
            },
            async reportEvent(_reporters, event) {
                events.push(event);

                if (events.length === 1) {
                    throw new Error('first report failed');
                }

                return [];
            },
            async reportResult() {
                return [];
            }
        },
        events() {
            return events;
        }
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/engine/reporter-event-queue.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'reporter event queue continues after a previous report rejects',
            metadata: {},
            async body(scope: OverkillScope) {
                const rejectingDispatcher = createRejectingDispatcher();
                const queue = createReporterEventQueue([], {
                    reporterDispatcher: rejectingDispatcher.dispatcher
                });

                await scope.assert.rejects(async function reportFirstEvent() {
                    await queue.report({ kind: 'suite-start', suitePath: [ 'first' ] });
                }, { message: 'first report failed' });
                await queue.report({ kind: 'suite-start', suitePath: [ 'second' ] });

                scope.assert.deepEqual(
                    rejectingDispatcher.events().map(function toSuiteName(event) {
                        return event.kind === 'suite-start' ? event.suitePath[0] : null;
                    }),
                    [ 'first', 'second' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
