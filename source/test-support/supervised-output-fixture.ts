import type { TestPlan } from '../engine/test-plan.ts';
import { defaultRunEngine } from '../run/default-run-engine.ts';
import { collectedRunPlanFromTestPlan } from '../run/collected-run-plan.ts';
import { supervisedAssignedWork } from '../run/supervised-protocol.ts';
import type { SupervisedChildProcess } from '../run/supervised-child-process.ts';
import {
    createFakeSupervisedChildProcess,
    type FakeSupervisedChildRunContext
} from './fake-supervised-child-process.ts';
import { runResultFactory } from './run-result-factory.ts';

const integrationCaptureControlsOutputFixturePath =
    'source/integration-tests/run/fixtures/integration-capture-controls-output.test.ts';

function integrationOutputTestPlan(file: string): TestPlan {
    const testNode = defaultRunEngine.createTestCase({
        definitionLocations: [ { kind: 'unknown' as const } ],
        annotations: { tags: [ 'output' ] },
        controls: file === integrationCaptureControlsOutputFixturePath ? { capture: 'live' } : {},
        title: 'captures output',
        body(scope) {
            scope.assert.true(true);

            return scope.assert.collect();
        }
    });

    return defaultRunEngine.createTestPlanFromTestFiles({
        files: [ { file, testNode } ],
        root: {
            annotations: { tags: [ 'output' ] },
            controls: {},
            title: process.cwd()
        }
    });
}

function runFakeIntegrationOutputChild(context: FakeSupervisedChildRunContext): void {
    const [ work ] = supervisedAssignedWork(context.assignment);

    if (work === undefined) {
        context.emitExit();

        return;
    }

    context.emitMessage({
        event: {
            attempt: 0,
            case: work.case,
            definitionLocations: [ { kind: 'unknown' } ],
            kind: 'test-start',
            suitePath: [],
            workId: work
        },
        kind: 'event'
    });
    context.stdout.emit('case stdout\n');
    context.stderr.emit('case stderr\n');
    context.emitMessage({
        event: {
            completion: 'final',
            attempt: 0,
            artifacts: [],
            case: work.case,
            definitionLocations: [ { kind: 'unknown' } ],
            kind: 'test-end',
            outcome: null,
            suitePath: [],
            verdict: 'pass',
            durationMicroseconds: 0,
            workId: work
        },
        kind: 'event'
    });
    context.emitMessage({
        kind: 'result',
        result: runResultFactory.build({ perTest: [ { id: work.case, workId: work, verdict: 'pass' } ] })
    });
    context.emitExit();
}

export async function startFakeIntegrationOutputChild(): Promise<SupervisedChildProcess> {
    return createFakeSupervisedChildProcess({
        collect(input) {
            return {
                collectedPlan: collectedRunPlanFromTestPlan(integrationOutputTestPlan(input.file)),
                runnerErrors: []
            };
        },
        run(context) {
            context.stdout.emit('collection stdout\n');
            runFakeIntegrationOutputChild(context);
        }
    });
}
