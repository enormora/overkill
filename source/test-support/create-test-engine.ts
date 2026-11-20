import { createDeterministicClock, type Clock } from '@enormora/clock';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { createEngine, type Engine } from '../engine/engine.ts';
import { createExecute, type ExecutionDriver } from '../engine/execution.ts';
import { createReporterDispatcher, type ReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { isTestNode, type TestNode } from '../engine/test-node.ts';
import type { RunResult } from '../engine/run-result.ts';

export const engineCasePassed = defineCompositeAssertion({
    name: 'engine case passes',
    assert(check, result: RunResult) {
        return check.group([
            check.equal(result.status, 'passed'),
            check.equal(result.summary.planned, 1),
            check.equal(result.summary.passed, 1),
            check.empty(result.runnerErrors)
        ]);
    }
});

export type EngineCaseBody = Extract<
    Parameters<Engine['createTestCase']>[0]['body'],
    (...arguments_: readonly never[]) => unknown
>;

export type EngineThrowingCaseBody = Extract<
    Parameters<Engine['createThrowingTestCase']>[0]['body'],
    (...arguments_: readonly never[]) => unknown
>;

export function subjectTestNode<Node>(node: Node): Node & TestNode {
    if (!isTestNode(node)) {
        throw new TypeError('Expected a test node accepted by the engine under test.');
    }
    return node;
}

function ignoreOutputLine(): void {
    return undefined;
}

function readNoActiveResourceTypes(): readonly string[] {
    return [];
}

export function createTestExecution(
    wallClock: Clock,
    reporterDispatcher: ReporterDispatcher
): ExecutionDriver {
    return createExecute({
        benchmarkEnvironment: null,
        asyncLeakDiagnostics: 'enabled',
        readActiveResourceTypes: readNoActiveResourceTypes,
        reporterDispatcher,
        wallClock
    });
}

export function createTimedTestEngine(wallClock: Clock): Engine {
    return createEngine({
        execute: createExecute({
            benchmarkEnvironment: null,
            asyncLeakDiagnostics: 'enabled',
            readActiveResourceTypes: readNoActiveResourceTypes,
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: ignoreOutputLine },
                stdout: { writeLine: ignoreOutputLine },
                wallClock
            }),
            wallClock
        }),
        wallClock
    });
}

export function createTestEngine(): Engine {
    return createTimedTestEngine(createDeterministicClock({ initialUnixEpochMicroseconds: 0n }));
}

export async function executeEngineCase(body: EngineCaseBody): Promise<RunResult> {
    const engine = createTestEngine();
    const metadata = { annotations: {}, controls: {} };
    const node = engine.createTestCase({
        ...metadata,
        body,
        definitionLocations: [ { kind: 'unknown' } ],
        title: 'subject'
    });
    return await engine.execute(engine.createTestPlan(engine.createRoot({
        ...metadata,
        children: [ node ],
        title: 'engine under test'
    })));
}
