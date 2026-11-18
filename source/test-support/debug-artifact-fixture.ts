import {
    isTestDebugArtifact,
    type RunResult,
    type TestDebugArtifact,
    type WorkId
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from './create-test-engine.ts';

type DebugArtifactFixture = { readonly artifact: TestDebugArtifact; readonly result: RunResult; };
export async function debugArtifactFixture(title: string): Promise<DebugArtifactFixture> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'root',
        children: [ engine.createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title,
            body(scope) {
                scope.assert.equal(1, 1);
                return scope.assert.collect();
            }
        }) ]
    }));
    const result = await engine.execute(plan, {
        debug: { mode: 'all' },
        execution: { mode: 'serial-in-process' },
        retryPolicy: null,
        reporters: [],
        runFacts: {},
        startedAt: '1970-01-01T00:00:00.000Z'
    });
    const artifact = result.artifacts.find(isTestDebugArtifact);
    if (artifact === undefined) {
        throw new Error('Expected debug evidence from the fixture.');
    }
    return { artifact, result };
}

const checkpointDurationMicroseconds = 5;
export async function debugArtifactForWork(work: WorkId): Promise<TestDebugArtifact> {
    const { artifact } = await debugArtifactFixture('owned debug case');
    return {
        ...artifact,
        id: {
            ...artifact.id,
            familyVariant: work.familyVariant,
            runtimes: work.runtimes,
            workload: work.workload,
            attempt: { index: 0 },
            scope: { kind: 'case', case: work.case, activeCases: [ work.case ], confidence: 'active-case' }
        },
        payload: { ...artifact.payload, durationMicroseconds: checkpointDurationMicroseconds }
    };
}
