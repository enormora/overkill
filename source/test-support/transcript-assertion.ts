import type { RunResult } from '../packages/engine/engine.entry-point.ts';
import { type EngineCaseBody, createTestEngine } from './create-test-engine.ts';

export async function transcriptAssertion(
    operation: (...parameters: Parameters<EngineCaseBody>) => void
): Promise<RunResult> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(
        engine.createRoot({
            title: 'transcript',
            annotations: {},
            controls: {},
            children: [
                engine.createTestCase({
                    title: 'assertion',
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    body(scope) {
                        operation(scope);
                        return scope.assert.collect();
                    }
                })
            ]
        })
    );
    return await engine.execute(plan);
}
