import { createStoredValue } from '../stored-value.ts';
import { observeCaseResourceOwners } from './resource-owner-observation.ts';
import { caseWithAsyncLeakPolicy, type AsyncLeakCheckedCase } from './execution-async-leak-policy.ts';
import { executeCaseBody } from './execution-supervision.ts';
import { interruptedPropertyEvidence } from './property-evidence.ts';
import type { ExecuteCaseInput } from './case-attempt-context.ts';
import type { PerTestResult, PropertyCaseEvidence } from './run-result.ts';

type TimedLeakCheckedCase = {
    readonly endedAtMicroseconds: number;
    readonly leakCheckedCase: AsyncLeakCheckedCase;
    readonly startedAtMicroseconds: number;
};

async function reportBenchmarkProgress(
    input: ExecuteCaseInput,
    benchmark: NonNullable<PerTestResult['benchmark']>
): Promise<void> {
    const errors = await input.context.dependencies.asyncLeakMonitor.runOutsideCase(
        async function deliverCheckpoint() {
            return input.context.reporterDelivery.reportEvent({
                kind: 'benchmark-progress',
                benchmark,
                attempt: input.attempt,
                case: input.testCase.id,
                definitionLocations: input.testCase.definitionLocations,
                suitePath: input.testCase.suitePath,
                workId: input.testCase.workId
            });
        }
    );
    for (const error of errors) {
        input.supervision.recordRunnerError(error);
    }
}

async function runObservedCase(input: ExecuteCaseInput): Promise<Awaited<ReturnType<typeof executeCaseBody>>> {
    const retained = createStoredValue<PropertyCaseEvidence | null>(null);
    const completed = await executeCaseBody({
        seed: input.options.seed,
        async onBenchmarkUpdate(benchmark) {
            await reportBenchmarkProgress(input, benchmark);
        },
        async onPropertyUpdate(property) {
            retained.write(property);
            const errors = await input.context.dependencies.asyncLeakMonitor.runOutsideCase(
                async function deliverPropertyEvidence() {
                    return input.context.reporterDelivery.reportEvent({
                        kind: 'property-progress',
                        property,
                        attempt: input.attempt,
                        case: input.testCase.id,
                        definitionLocations: input.testCase.definitionLocations,
                        suitePath: input.testCase.suitePath,
                        workId: input.testCase.workId
                    });
                }
            );
            for (const error of errors) {
                input.supervision.recordRunnerError(error);
            }
        },
        propertyRun: input.options.propertyRun,
        testCase: input.testCase,
        timeoutPolicy: input.options.timeoutPolicy,
        supervision: input.supervision,
        dependencies: input.context.dependencies,
        attempt: { index: input.attempt }
    });
    const property = interruptedPropertyEvidence(completed.result.property ?? retained.read());
    if (property === null) {
        return completed;
    }
    return {
        ...completed,
        result: {
            ...completed.result,
            property,
            attempts: [
                { ...completed.result.attempts[0], property },
                ...completed.result.attempts.slice(1).map(function retainEvidence(attempt) {
                    return { ...attempt, property };
                })
            ]
        }
    };
}

export async function executeTimedLeakCheckedCase(input: ExecuteCaseInput): Promise<TimedLeakCheckedCase> {
    const startedAtMicroseconds = Number(input.context.dependencies.wallClock.currentMonotonicMicroseconds);
    const observedCase = await observeCaseResourceOwners(
        input.context.dependencies.readActiveResourceTypes,
        async function observeOwners() {
            return await input.context.dependencies.asyncLeakMonitor.runCase(
                input.testCase,
                async function runCase() {
                    return await runObservedCase(input);
                }
            );
        }
    );
    const leakCheckedCase = await caseWithAsyncLeakPolicy({
        readResourceBaseline() {
            return observedCase.baseline;
        },
        ambiguousResources() {
            return observedCase.ambiguousResources;
        },
        dependencies: input.context.dependencies,
        executedCase: observedCase.result,
        includeActiveResourceLeaks: input.options.execution.mode === 'serial-in-process',
        testCase: input.testCase
    });

    return {
        endedAtMicroseconds: Number(input.context.dependencies.wallClock.currentMonotonicMicroseconds),
        leakCheckedCase,
        startedAtMicroseconds
    };
}
