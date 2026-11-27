import type { RunResult } from '../engine/run-result.ts';
import { type EngineCaseBody, createTestEngine as createEngine } from './create-test-engine.ts';

export async function executeSingleBody(body: EngineCaseBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body,
                        annotations: {},
                        controls: {},
                        title: 'case'
                    })
                ],
                annotations: {},
                controls: {},
                title: 'root'
            })
        )
    );
}
