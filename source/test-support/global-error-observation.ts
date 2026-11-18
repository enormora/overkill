import { EventEmitter } from 'node:events';
import type { TestPlanCase } from '../engine/test-plan.ts';
import { type ExecutionErrorOwnership, createExecutionErrorOwnership } from '../engine/execution-error-ownership.ts';
import {
    type ExecutionGlobalErrorObserver,
    createOwnedGlobalErrorObserver
} from '../engine/execution-global-error-observer.ts';
import { createEngine } from '../packages/engine/engine.entry-point.ts';

type GlobalErrorFixture = {
    readonly events: EventEmitter;
    readonly ownership: ExecutionErrorOwnership;
    readonly observer: ExecutionGlobalErrorObserver;
    readonly testCase: TestPlanCase;
};
export function globalErrorObservation(): GlobalErrorFixture {
    const events = new EventEmitter();
    const ownership = createExecutionErrorOwnership(events);
    const observer = createOwnedGlobalErrorObserver('in-process', ownership);
    const engine = createEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        title: 'observed run',
        annotations: {},
        controls: {},
        children: [ engine.createTestCase({
            title: 'case',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body() {
                throw new Error('The observer must not execute test bodies.');
            }
        }) ]
    }));
    return { events, ownership, observer, testCase: plan.cases[0] };
}
