import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createPlainOutputRenderer } from './reporter-output.ts';
import type { ReporterDispatcher } from './reporter-dispatcher.ts';
import type { ReporterEvent } from './reporter.ts';
import { createReporterEventQueue } from './reporter-event-queue.ts';

const definitionLocation = { column: null, file: '', line: null };

function suitePath(title: string): ReporterEvent & { readonly kind: 'suite-start'; } {
    return {
        kind: 'suite-start',
        suitePath: [ { definitionLocations: [ definitionLocation ], title } ]
    };
}

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
            },
            async trackRunnerErrorDelivery(work) {
                return {
                    deliveredRunnerErrors: [],
                    result: await work()
                };
            }
        },
        events() {
            return events;
        }
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/engine/reporter-event-queue.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'reporter event queue continues after a previous report rejects',
            metadata: {},
            async body(scope: OverkillScope) {
                const rejectingDispatcher = createRejectingDispatcher();
                const queue = createReporterEventQueue([], createPlainOutputRenderer(), {
                    reporterDispatcher: rejectingDispatcher.dispatcher
                });

                await scope.assert.rejects(async function reportFirstEvent() {
                    await queue.report(suitePath('first'));
                }, { message: 'first report failed' });
                await queue.report(suitePath('second'));

                scope.assert.deepEqual(
                    rejectingDispatcher.events().map(function toSuiteName(event) {
                        return event.kind === 'suite-start' ? event.suitePath[0]?.title : null;
                    }),
                    [ 'first', 'second' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
