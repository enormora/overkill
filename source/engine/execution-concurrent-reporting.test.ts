import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { Engine } from './engine.ts';
import type { RealTimeReporter, ReporterEvent } from './reporter.ts';
import type { RunResult } from './run-result.ts';
import type { TestCase } from './test-node.ts';
import type { TestPlan } from './test-plan.ts';

type ReporterSignal = {
    readonly notify: () => void;
    readonly promise: Promise<void>;
};

type PlanOrderedConcurrentScenario = {
    readonly events: readonly ReporterEvent[];
    readonly releaseFirst: ReporterSignal;
    readonly reporter: RealTimeReporter;
    readonly secondEnded: ReporterSignal;
    readonly testPlan: TestPlan;
};

type ReporterSerializationScenario = {
    readonly endEntered: ReporterSignal;
    readonly maximumActiveEndReports: () => number;
    readonly releaseEnd: ReporterSignal;
    readonly reporter: RealTimeReporter;
    readonly testPlan: TestPlan;
};

function createReporterSignal(): ReporterSignal {
    let notify: () => void = function notifyUnsetSignal(): void {
        return undefined;
    };
    const promise = new Promise<void>(function resolveOnNotify(resolve) {
        notify = resolve;
    });

    return { notify, promise };
}

function eventCaseTitles(events: readonly ReporterEvent[], kind: 'test-end' | 'test-start'): readonly string[] {
    return events.flatMap(function toMatchingCaseTitle(event) {
        return event.kind === kind ? [ event.case.title ] : [];
    });
}

function createPassingCase(engine: Engine, title: string): TestCase {
    return engine.createTestCase({
        body(testScope) {
            testScope.assert.true(true, { message: `${title} passes` });
            return testScope.assert.collect();
        },
        metadata: {},
        title
    });
}

function createPlanOrderedConcurrentScenario(engine: Engine): PlanOrderedConcurrentScenario {
    const secondEnded = createReporterSignal();
    const releaseFirst = createReporterSignal();
    const events: ReporterEvent[] = [];
    const reporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'observer',
        onEvent(event) {
            events.push(event);

            if (event.kind === 'test-end' && event.case.title === 'second') {
                secondEnded.notify();
            }
        },
        onFinish: null,
        sinks: []
    };
    const testPlan = engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    async body(testScope) {
                        await releaseFirst.promise;
                        testScope.assert.true(true, { message: 'first passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    title: 'first'
                }),
                createPassingCase(engine, 'second')
            ],
            metadata: {},
            title: 'root'
        })
    );

    return { events, releaseFirst, reporter, secondEnded, testPlan };
}

async function executeConcurrentTestPlan(
    engine: Engine,
    testPlan: TestPlan,
    reporter: RealTimeReporter
): Promise<RunResult> {
    return await engine.execute(testPlan, {
        execution: { mode: 'concurrent-in-process' },
        reporters: [ reporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });
}

function createReporterSerializationScenario(engine: Engine): ReporterSerializationScenario {
    const endEntered = createReporterSignal();
    const releaseEnd = createReporterSignal();
    let activeEndReports = 0;
    let maximumActiveEndReports = 0;
    const reporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'observer',
        async onEvent(event) {
            if (event.kind !== 'test-end') {
                return;
            }

            activeEndReports += 1;
            maximumActiveEndReports = Math.max(maximumActiveEndReports, activeEndReports);
            endEntered.notify();
            await releaseEnd.promise;
            activeEndReports -= 1;
        },
        onFinish: null,
        sinks: []
    };
    const testPlan = engine.createTestPlan(
        engine.createRoot({
            children: [
                createPassingCase(engine, 'first'),
                createPassingCase(engine, 'second')
            ],
            metadata: {},
            title: 'root'
        })
    );

    return {
        endEntered,
        maximumActiveEndReports() {
            return maximumActiveEndReports;
        },
        releaseEnd,
        reporter,
        testPlan
    };
}

export const testSuite = createOverkillSuite({
    title: 'source/engine/execution-concurrent-reporting.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'execute() runs concurrent in-process cases with plan-ordered starts and results',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const scenario = createPlanOrderedConcurrentScenario(engine);
                const execution = executeConcurrentTestPlan(engine, scenario.testPlan, scenario.reporter);
                await scenario.secondEnded.promise;
                scenario.releaseFirst.notify();
                const result = await execution;

                scope.assert.deepEqual(eventCaseTitles(scenario.events, 'test-start'), [ 'first', 'second' ]);
                scope.assert.deepEqual(eventCaseTitles(scenario.events, 'test-end'), [ 'second', 'first' ]);
                scope.assert.deepEqual(
                    result.perTest.map(function toCaseName(testResult) {
                        return testResult.id.title;
                    }),
                    [ 'first', 'second' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() serializes reporter callbacks during concurrent execution',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const scenario = createReporterSerializationScenario(engine);
                const execution = executeConcurrentTestPlan(engine, scenario.testPlan, scenario.reporter);
                await scenario.endEntered.promise;
                await Promise.resolve();
                scenario.releaseEnd.notify();
                await execution;

                scope.assert.equal(scenario.maximumActiveEndReports(), 1);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
