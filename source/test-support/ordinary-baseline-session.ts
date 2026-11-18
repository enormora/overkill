import { createDeterministicClock } from '@enormora/clock';
import { type ReporterDispatcher, createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { type DefinedReporter, defineReporter, type ReporterEvent } from '../engine/reporter.ts';
import type { OrdinaryBaselineStore } from '../run/baseline-store.ts';

import type { OrdinaryBaselineWorkflow } from '../run/baseline-workflow.ts';
import { storedBaseline } from './baseline-case-fixture.ts';
import { memoryOrdinaryBaselines } from './memory-ordinary-baselines.ts';

type BaselineSessionFixture = {
    readonly workflow: OrdinaryBaselineWorkflow;
    readonly dispatcher: ReporterDispatcher;
    readonly reporter: DefinedReporter;
    readonly calls: readonly string[];
    readonly events: readonly ReporterEvent[];
    readonly store: OrdinaryBaselineStore;
};
export function ordinaryBaselineSessionFixture(): BaselineSessionFixture {
    const calls: string[] = [];
    const events: ReporterEvent[] = [];
    const store = memoryOrdinaryBaselines([]);
    const workflow: OrdinaryBaselineWorkflow = {
        changes: [ { kind: 'create', baseline: storedBaseline } ],
        warnings: [],
        prepareResult(result) {
            return result;
        },
        finish(result) {
            return result;
        },
        async evaluate(event) {
            return { event, errors: [] };
        },
        store: {
            ...store,
            async validate(changes) {
                calls.push(`validate:${changes.length}`);
                await store.validate(changes);
            },
            async publish(changes) {
                calls.push(`publish:${changes.length}`);
                return await store.publish(changes);
            }
        }
    };
    const dispatcher = createReporterDispatcher({
        wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
        stdout: {
            writeLine() {
                return undefined;
            }
        },
        stderr: {
            writeLine() {
                return undefined;
            }
        }
    });
    const reporter = defineReporter(function () {
        return {
            kind: 'real-time',
            name: 'baseline-events',
            sinks: [],
            onFinish: null,
            dispose: null,
            onEvent(event) {
                events.push(event);
            }
        };
    });
    return { workflow, dispatcher, reporter, calls, events, store };
}
