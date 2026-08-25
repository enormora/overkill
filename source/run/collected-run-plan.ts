import type { WallClock } from '@enormora/wall-clock';
import { serializeValue } from '../compare/serialized-value.ts';
import { caseIdentityKey, createCaseId, type CaseId } from '../engine/identity.ts';
import type {
    PerTestResult,
    RunResourceUsage,
    RunResult,
    RunnerError
} from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type {
    CollectedRunCase,
    CollectedRunFile,
    CollectedRunPlan,
    RunCaseFacts
} from './run-types.ts';

type RunResultTiming = {
    readonly resourceUsage: RunResourceUsage | null;
    readonly startedAtMs: number;
    readonly wallClock: WallClock;
};

function collectedCaseId(file: string, testCase: CollectedRunCase): CaseId {
    return createCaseId(file, testCase.suite, testCase.name, testCase.params);
}

function collectedCases(plan: CollectedRunPlan): readonly {
    readonly file: string;
    readonly testCase: CollectedRunCase;
}[] {
    return plan.files.flatMap(function collectFileCases(file) {
        return file.cases.map(function collectCase(testCase) {
            return {
                file: file.file,
                testCase
            };
        });
    });
}

function hasVerdict(verdict: PerTestResult['verdict']): (testResult: PerTestResult) => boolean {
    return function resultHasVerdict(testResult) {
        return testResult.verdict === verdict;
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

function countSuites(plan: CollectedRunPlan, perTest: readonly PerTestResult[]): RunResult['bySuite'] {
    let counts: RunResult['bySuite'] = {};
    const executedIds = new Set(perTest.map(function toIdentityKey(testResult) {
        return caseIdentityKey(testResult.id);
    }));

    for (const collectedCase of collectedCases(plan)) {
        counts = countSuitePath(counts, collectedCase.testCase.suite, 'discovered');
        counts = countSuitePath(counts, collectedCase.testCase.suite, 'planned');

        if (executedIds.has(caseIdentityKey(collectedCaseId(collectedCase.file, collectedCase.testCase)))) {
            counts = countSuitePath(counts, collectedCase.testCase.suite, 'executed');
        }
    }

    return counts;
}

function countOutcomes(plan: CollectedRunPlan, perTest: readonly PerTestResult[]): RunResult['summary'] {
    const planned = collectedCases(plan).length;

    return {
        crashed: perTest.filter(hasVerdict('crashed')).length,
        defined: plan.defined,
        discovered: planned,
        failed: perTest.filter(hasVerdict('fail')).length,
        inconclusive: perTest.filter(hasVerdict('inconclusive')).length,
        passed: perTest.filter(hasVerdict('pass')).length,
        planned,
        resourceExhausted: perTest.filter(hasVerdict('resource-exhausted')).length,
        runtimePolicy: perTest.filter(hasVerdict('runtime-policy')).length,
        skipped: perTest.filter(hasVerdict('skip')).length
    };
}

function collectRunPlanFile(file: string, cases: TestPlan['cases']): CollectedRunFile {
    return {
        cases: cases.map(function collectCase(testCase): CollectedRunCase {
            return {
                metadata: serializeValue(testCase.metadata),
                name: testCase.id.name,
                params: testCase.id.params,
                suite: testCase.id.suite
            };
        }),
        file
    };
}

export function collectedRunPlanFromTestPlan(testPlan: TestPlan): CollectedRunPlan {
    const files = new Map<string, TestPlan['cases']>();

    for (const testCase of testPlan.cases) {
        const file = testCase.id.file ?? '';
        files.set(file, [ ...files.get(file) ?? [], testCase ]);
    }

    return {
        defined: testPlan.defined,
        files: Array.from(files, function collectFile([ file, cases ]) {
            return collectRunPlanFile(file, cases);
        }),
        orphans: testPlan.orphans,
        root: {
            metadata: serializeValue(testPlan.root.metadata),
            name: testPlan.root.name
        }
    };
}

export function collectedRunCaseFacts(plan: CollectedRunPlan): readonly RunCaseFacts[] {
    return collectedCases(plan).map(function toRunCaseFacts(collectedCase): RunCaseFacts {
        return {
            id: collectedCaseId(collectedCase.file, collectedCase.testCase),
            metadata: collectedCase.testCase.metadata
        };
    });
}

export function collectedRunCaseIds(plan: CollectedRunPlan): readonly CaseId[] {
    return collectedCases(plan).map(function toCaseId(collectedCase) {
        return collectedCaseId(collectedCase.file, collectedCase.testCase);
    });
}

export function createRunResultFromCollectedPlan(
    plan: CollectedRunPlan,
    perTest: readonly PerTestResult[],
    runnerErrors: readonly RunnerError[],
    timing: RunResultTiming
): RunResult {
    return {
        artifacts: [],
        bySuite: countSuites(plan, perTest),
        orphans: plan.orphans,
        perTest,
        resourceUsage: timing.resourceUsage,
        runnerErrors,
        summary: countOutcomes(plan, perTest),
        wallTimeMs: timing.wallClock.currentTimestampInMilliseconds - timing.startedAtMs
    };
}
