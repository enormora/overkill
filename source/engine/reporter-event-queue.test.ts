import { suite, test } from '@overkill-dev/test';

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

export const testNode = suite('Reporter event queue', [
    test('continues after a previous report rejects', async function (scope) {
        const rejectingDispatcher = createRejectingDispatcher();
        const queue = createReporterEventQueue(rejectingDispatcher.delivery);

        await scope.assert.rejects(async function reportFirstEvent() {
            await queue.reportEvent(suitePath('first'));
        }, { message: 'first report failed' });
        await queue.reportEvent(suitePath('second'));

        scope.assert.deepEqual(
            rejectingDispatcher.events().map(function toSuiteName(event) {
                return event.kind === 'suite-start' ? event.suitePath[0]?.title : null;
            }),
            [ 'first', 'second' ]
        );

        return scope.assert.collect();
    })
]);
