import type { TestPlanCase, TestPlan } from '../engine/test-plan.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { createTestEngine } from './create-test-engine.ts';
import { runResultFactory } from './run-result-factory.ts';

export function observationPlan(): TestPlan {
    const engine = createTestEngine();
    return engine
        .createTestPlan(engine.createRoot({
            title: 'root',
            annotations: {},
            controls: {},
            children: [
                engine.createTestCase({
                    title: 'owned case',
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    body(scope) {
                        return scope.assert.collect();
                    }
                })
            ]
        }));
}
export function observationError(): RunnerError {
    const error = runResultFactory.build({ runnerErrors: [ { message: 'Observed failure.' } ] }).runnerErrors[0];
    if (error === undefined) {
        throw new Error('Missing error fixture.');
    }
    return error;
}

export function observationCase(): TestPlanCase {
    return observationPlan().cases[0];
}
