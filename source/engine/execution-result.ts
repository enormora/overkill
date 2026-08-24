import type { WallClock } from '@enormora/wall-clock';
import { caseIdentityKey } from './identity.ts';
import type {
    PerTestResult,
    RunResourceUsage,
    RunResult,
    RunnerError
} from './run-result.ts';
import type { TestPlan } from './test-plan.ts';

type RunResultTiming = {
    readonly resourceUsage: RunResourceUsage | null;
    readonly startedAtMs: number;
    readonly wallClock: WallClock;
};

function hasFailed(testResult: PerTestResult): boolean {
    return testResult.verdict === 'fail';
}

function isInconclusive(testResult: PerTestResult): boolean {
    return testResult.verdict === 'inconclusive';
}

function hasPassed(testResult: PerTestResult): boolean {
    return testResult.verdict === 'pass';
}

function wasSkipped(testResult: PerTestResult): boolean {
    return testResult.verdict === 'skip';
}

function resourceExhausted(testResult: PerTestResult): boolean {
    return testResult.verdict === 'resource-exhausted';
}

function crashed(testResult: PerTestResult): boolean {
    return testResult.verdict === 'crashed';
}

function runtimePolicy(testResult: PerTestResult): boolean {
    return testResult.verdict === 'runtime-policy';
}

function countOutcomes(testPlan: TestPlan, perTest: readonly PerTestResult[]): RunResult['summary'] {
    return {
        crashed: perTest.filter(crashed).length,
        defined: testPlan.defined,
        discovered: testPlan.discoveredCases.length,
        failed: perTest.filter(hasFailed).length,
        inconclusive: perTest.filter(isInconclusive).length,
        passed: perTest.filter(hasPassed).length,
        planned: testPlan.cases.length,
        resourceExhausted: perTest.filter(resourceExhausted).length,
        runtimePolicy: perTest.filter(runtimePolicy).length,
        skipped: perTest.filter(wasSkipped).length
    };
}

function suiteKey(suitePath: readonly string[]): string {
    return suitePath.join(' > ');
}

function emptySuiteRunCounts(): RunResult['bySuite'][string] {
    return { discovered: 0, executed: 0, planned: 0 };
}

function incrementSuiteRunCounts(
    counts: RunResult['bySuite'][string],
    field: 'discovered' | 'executed' | 'planned'
): RunResult['bySuite'][string] {
    return {
        discovered: counts.discovered + (field === 'discovered' ? 1 : 0),
        executed: counts.executed + (field === 'executed' ? 1 : 0),
        planned: counts.planned + (field === 'planned' ? 1 : 0)
    };
}

function countSuitePath(
    counts: RunResult['bySuite'],
    suitePath: readonly string[],
    field: 'discovered' | 'executed' | 'planned'
): RunResult['bySuite'] {
    let updatedCounts = counts;

    for (let pathLength = 1; pathLength <= suitePath.length; pathLength += 1) {
        const key = suiteKey(suitePath.slice(0, pathLength));
        updatedCounts = {
            ...updatedCounts,
            [key]: incrementSuiteRunCounts(updatedCounts[key] ?? emptySuiteRunCounts(), field)
        };
    }

    return updatedCounts;
}

function countSuites(testPlan: TestPlan, perTest: readonly PerTestResult[]): RunResult['bySuite'] {
    let counts: RunResult['bySuite'] = {};
    const executedIds = new Set(
        perTest.map(function toId(result) {
            return caseIdentityKey(result.id);
        })
    );

    for (const testCase of testPlan.discoveredCases) {
        counts = countSuitePath(counts, testCase.suitePath, 'discovered');
    }

    for (const testCase of testPlan.cases) {
        counts = countSuitePath(counts, testCase.suitePath, 'planned');

        if (executedIds.has(caseIdentityKey(testCase.id))) {
            counts = countSuitePath(counts, testCase.suitePath, 'executed');
        }
    }

    return counts;
}

export function createRunResult(
    testPlan: TestPlan,
    perTest: readonly PerTestResult[],
    reporterErrors: readonly RunnerError[],
    timing: RunResultTiming
): RunResult {
    return {
        artifacts: [],
        bySuite: countSuites(testPlan, perTest),
        orphans: testPlan.orphans,
        perTest,
        resourceUsage: timing.resourceUsage,
        runnerErrors: reporterErrors,
        summary: countOutcomes(testPlan, perTest),
        wallTimeMs: timing.wallClock.currentTimestampInMilliseconds - timing.startedAtMs
    };
}
