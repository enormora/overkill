import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineReporter,
    type DefinedReporter,
    type ReporterEvent,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { TestRuntimePolicy } from './case-execution.ts';
import type { Engine } from './engine.ts';
import type { RunResult } from './run-result.ts';

type LifecycleRecorder = {
    readonly events: () => readonly ReporterEvent['kind'][];
    readonly reporter: DefinedReporter;
};

type RuntimePolicyProbe = {
    readonly caseErrorReads: () => number;
    readonly caseRuns: () => number;
    readonly runtimePolicy: TestRuntimePolicy;
};

const epochStart = '1970-01-01T00:00:00.000Z';

function createLifecycleRecorder(): LifecycleRecorder {
    const events: ReporterEvent['kind'][] = [];
    const reporter = defineReporter(function skippedLifecycleReporter() {
        return {
            dispose: null,
            kind: 'real-time' as const,
            name: 'skipped lifecycle',
            onEvent(event: ReporterEvent) {
                events.push(event.kind);
            },
            onFinish: null,
            sinks: []
        };
    });

    return {
        events() {
            return events;
        },
        reporter
    };
}

function createRuntimePolicyProbe(): RuntimePolicyProbe {
    let caseErrorReads = 0;
    let caseRuns = 0;

    return {
        caseErrorReads() {
            return caseErrorReads;
        },
        caseRuns() {
            return caseRuns;
        },
        runtimePolicy: {
            async runCase<Value>(_testCase: unknown, run: () => Promise<Value>): Promise<Value> {
                caseRuns += 1;

                return await run();
            },
            async runLoad<Value>(run: () => Promise<Value>): Promise<Value> {
                return await run();
            },
            takeCaseErrors() {
                caseErrorReads += 1;

                return [];
            },
            takeRunErrors() {
                return [];
            }
        }
    };
}

function createSkippedExecutionPlan(engine: Engine): ReturnType<Engine['createTestPlan']> {
    const skippedCase = engine.createSkippedTestCase({
        annotations: { tags: [ 'platform' ] },
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        reason: 'unsupported platform',
        title: 'conditional'
    });

    return engine.createTestPlan(engine.createRoot({
        children: [
            engine.createSuite({
                annotations: {},
                children: [ skippedCase ],
                controls: {},
                definitionLocations: [ { kind: 'unknown' as const } ],
                title: 'runtime'
            })
        ],
        annotations: {},
        controls: {},
        title: 'root'
    }));
}

function assertSkippedExecutionResult(scope: OverkillScope, result: RunResult): void {
    scope.assert.deepEqual(result.perTest, [
        {
            id: {
                file: null,
                params: null,
                suite: [ 'runtime' ],
                title: 'conditional'
            },
            outcome: { kind: 'skip', reason: 'unsupported platform' },
            verdict: 'skip'
        }
    ]);
    scope.assert.deepEqual(result.summary, {
        crashed: 0,
        defined: 2,
        discovered: 1,
        failed: 0,
        inconclusive: 0,
        passed: 0,
        planned: 1,
        resourceExhausted: 0,
        runtimePolicy: 0,
        skipped: 1
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/skipped-test-execution.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() records skipped cases without running body infrastructure',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const lifecycle = createLifecycleRecorder();
                const probe = createRuntimePolicyProbe();
                const testPlan = createSkippedExecutionPlan(engine);
                const result = await engine.execute(testPlan, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [ lifecycle.reporter ],
                    runFacts: {},
                    runtimePolicy: probe.runtimePolicy,
                    startedAt: epochStart
                });

                assertSkippedExecutionResult(scope, result);
                scope.assert.deepEqual(lifecycle.events(), [
                    'run-start',
                    'suite-start',
                    'test-start',
                    'test-end',
                    'suite-end',
                    'run-end'
                ]);
                scope.assert.deepEqual(
                    { caseErrorReads: probe.caseErrorReads(), caseRuns: probe.caseRuns() },
                    { caseErrorReads: 0, caseRuns: 0 }
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
