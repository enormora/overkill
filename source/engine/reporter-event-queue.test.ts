import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { ReporterEvent } from './reporter.ts';
import { createReporterEventQueue } from './reporter-event-queue.ts';

const definitionLocation = { kind: 'unknown' as const };

function suitePath(title: string): ReporterEvent & { readonly kind: 'suite-start'; } {
    return {
        kind: 'suite-start',
        suitePath: [ { definitionLocations: [ definitionLocation ], title } ]
    };
}

type RejectingDispatcher = {
    readonly delivery: ReporterDelivery;
    readonly events: () => readonly ReporterEvent[];
};

function createRejectingDispatcher(): RejectingDispatcher {
    const events: ReporterEvent[] = [];

    return {
        delivery: {
            async disposeReporters() {
                return [];
            },
            async reportEvent(event) {
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/reporter-event-queue.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter event queue continues after a previous report rejects',
            metadata: {},
            async body(scope: OverkillScope) {
                const rejectingDispatcher = createRejectingDispatcher();
                const queue = createReporterEventQueue(rejectingDispatcher.delivery);

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
