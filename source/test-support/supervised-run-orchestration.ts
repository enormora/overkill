import type { SupervisedChildProcess } from '../run/supervised-child-process.ts';
import { supervisedAssignedWork } from '../run/supervised-protocol.ts';
import { runIsolatedProcessCommand } from '../run/run-isolated-process.ts';
import type { RunnerError, RunResult } from '../engine/run-result.ts';
import { createCollectedPlan } from './worker-pool-execution-state.ts';
import { processUsageSample } from './deterministic-run-fixtures.ts';
import { passingIsolatedWorkerRun, type IsolatedWorkerFixture } from './isolated-worker-run.ts';
import {
    createFakeSupervisedChildProcess,
    type FakeSupervisedChildRunContext
} from './fake-supervised-child-process.ts';
import { defaultIntegrationProfile } from './run-command-factory.ts';
import { runResultFactory } from './run-result-factory.ts';

type SupervisedRunFailure = 'budget' | 'collection-failure' | 'run-failure' | 'start-failure';
type SupervisedProtocolScenario = 'duplicate-result' | 'empty-result' | 'forbidden-event';
export type SupervisedScenario = SupervisedProtocolScenario | SupervisedRunFailure | 'collection-sample' | 'pass';
type SupervisedRunFixture = { readonly execute: () => Promise<RunResult>; readonly events: readonly string[]; };
function runnerFailure(): RunnerError {
    return {
        attributedTo: null,
        attributedToAttempt: null,
        attributedToWork: null,
        cause: null,
        diagnostics: [],
        message: 'child failed',
        subtype: 'loader'
    };
}
function beginChildCases(context: FakeSupervisedChildRunContext): void {
    for (const workId of supervisedAssignedWork(context.assignment)) {
        context.emitMessage({
            kind: 'event',
            event: {
                kind: 'test-start',
                attempt: 0,
                case: workId.case,
                workId,
                definitionLocations: [ { kind: 'unknown' } ],
                suitePath: []
            }
        });
    }
}
function completeChildCases(context: FakeSupervisedChildRunContext, result: RunResult): void {
    for (const testCase of result.perTest) {
        context.emitMessage({
            kind: 'event',
            event: {
                kind: 'test-end',
                attempt: 0,
                case: testCase.id,
                workId: testCase.workId,
                definitionLocations: testCase.definitionLocations,
                suitePath: [],
                property: testCase.property,
                benchmark: testCase.benchmark,
                completion: 'final',
                artifacts: [],
                outcome: testCase.outcome,
                verdict: testCase.verdict,
                durationMicroseconds: testCase.durationMicroseconds
            }
        });
    }
}
function completeChildRun(context: FakeSupervisedChildRunContext, scenario: SupervisedScenario): void {
    const work = supervisedAssignedWork(context.assignment);
    const result = runResultFactory.build({
        summary: { discovered: work.length, planned: work.length, passed: work.length },
        perTest: work.map(function (workId) {
            return { id: workId.case, workId, outcome: { kind: 'pass' } };
        }),
        runnerErrors: scenario === 'run-failure' ? [ runnerFailure() ] : []
    });
    completeChildCases(context, result);
    context.emitMessage({ kind: 'result', result });
    if (scenario === 'duplicate-result') {
        context.emitMessage({ kind: 'result', result });
    }
    context.emitExit();
}
function rejectChildProtocol(context: FakeSupervisedChildRunContext, scenario: SupervisedScenario): boolean {
    if (scenario !== 'empty-result' && scenario !== 'forbidden-event') {
        return false;
    }
    const result = runResultFactory.build({ status: 'passed', perTest: [] });
    context.emitMessage(
        scenario === 'empty-result' ? { kind: 'result', result } : { kind: 'event', event: { kind: 'run-end', result } }
    );
    context.emitExit();
    return true;
}
function executeChild(context: FakeSupervisedChildRunContext, scenario: SupervisedScenario): void {
    if (rejectChildProtocol(context, scenario)) {
        return;
    }
    beginChildCases(context);
    context.stdout.emit('child output');
    context.stderr.emit('child diagnostics');
    if (scenario === 'budget') {
        context.emitSample({
            activeResourceCount: 2,
            activeResourceTypes: [ 'Timeout', 'Immediate' ],
            capturedAtMicroseconds: 1,
            javaScriptEngineHeapBytes: 0,
            residentSetBytes: 0
        });
    }
    if (context.isKilled()) {
        return;
    }
    completeChildRun(context, scenario);
}
function supervisedInput(
    scenario: SupervisedScenario,
    timed: boolean,
    capture: 'buffered' | 'live'
): IsolatedWorkerFixture {
    const original = passingIsolatedWorkerRun(timed, false);
    const profile = defaultIntegrationProfile({
        execution: { processModel: 'supervised-process', scheduling: 'serial' },
        processUsage: {
            measure: scenario === 'budget',
            budgets: { activeResourceCount: scenario === 'budget' ? 1 : null }
        }
    });
    const config = { ...original.input.config, profiles: { integration: profile } };
    const request = { ...original.input.request, capture };
    return {
        ...original,
        command: { ...original.command, config, request },
        input: { ...original.input, profile, config, request }
    };
}
function memorySupervisedChild(scenario: SupervisedScenario, record: (event: string) => void): SupervisedChildProcess {
    const originalPlan = createCollectedPlan();
    const plan = { ...originalPlan, discoveredFiles: originalPlan.files };
    return createFakeSupervisedChildProcess({
        collect(input) {
            record('collect');
            if (scenario === 'collection-sample') {
                input.emitMessage({ kind: 'sample', sample: processUsageSample(0, 0, 0) });
            } else if (scenario === 'collection-failure') {
                throw new Error('child collection failed');
            }
            return { collectedPlan: plan, runnerErrors: [] };
        },
        run(context) {
            record('run');
            executeChild(context, scenario);
        }
    });
}
export function supervisedRunOrchestration(
    scenario: SupervisedScenario,
    timed: boolean,
    capture: 'buffered' | 'live'
): SupervisedRunFixture {
    const original = supervisedInput(scenario, timed, capture);
    const events: string[] = [];
    const record = function (event: string): void {
        events.push(event);
    };
    const dependencies: IsolatedWorkerFixture['dependencies'] = {
        ...original.dependencies,
        liveOutput: {
            stdout: {
                write(chunk) {
                    record(`stdout:${Buffer.from(chunk).toString()}`);
                }
            },
            stderr: {
                write(chunk) {
                    record(`stderr:${Buffer.from(chunk).toString()}`);
                }
            }
        },
        async startSupervisedChild() {
            record('start');
            if (scenario === 'start-failure') {
                throw new Error('child start failed');
            }
            return memorySupervisedChild(scenario, record);
        }
    };
    return {
        events,
        async execute() {
            const result = runIsolatedProcessCommand(original.command, dependencies, {
                ...original.options,
                signal: null
            }, original.input);
            if (result === null) {
                throw new Error('Expected supervised execution.');
            }
            return await result;
        }
    };
}
