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

function collectedCases(files: readonly CollectedRunFile[]): readonly {
    readonly file: string;
    readonly testCase: CollectedRunCase;
}[] {
    return files.flatMap(function collectFileCases(file) {
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

    for (const collectedCase of collectedCases(plan.discoveredFiles)) {
        counts = countSuitePath(counts, collectedCase.testCase.suite, 'discovered');
    }

    for (const collectedCase of collectedCases(plan.files)) {
        counts = countSuitePath(counts, collectedCase.testCase.suite, 'planned');

        if (executedIds.has(caseIdentityKey(collectedCaseId(collectedCase.file, collectedCase.testCase)))) {
            counts = countSuitePath(counts, collectedCase.testCase.suite, 'executed');
        }
    }

    return counts;
}

function countOutcomes(plan: CollectedRunPlan, perTest: readonly PerTestResult[]): RunResult['summary'] {
    const discovered = collectedCases(plan.discoveredFiles).length;
    const planned = collectedCases(plan.files).length;

    return {
        crashed: perTest.filter(hasVerdict('crashed')).length,
        defined: plan.defined,
        discovered,
        failed: perTest.filter(hasVerdict('fail')).length,
        inconclusive: perTest.filter(hasVerdict('inconclusive')).length,
        passed: perTest.filter(hasVerdict('pass')).length,
        planned,
        resourceExhausted: perTest.filter(hasVerdict('resource-exhausted')).length,
        runtimePolicy: perTest.filter(hasVerdict('runtime-policy')).length,
        skipped: perTest.filter(hasVerdict('skip')).length
    };
}

function collectRunPlanFile(file: string, cases: readonly TestPlan['cases'][number][]): CollectedRunFile {
    return {
        cases: cases.map(function collectCase(testCase): CollectedRunCase {
            return {
                definitionLocation: testCase.definitionLocation,
                metadata: testCase.metadata,
                name: testCase.id.name,
                params: testCase.id.params,
                suite: testCase.id.suite,
                suiteDefinitionLocations: testCase.suiteDefinitionLocations
            };
        }),
        file
    };
}

function collectedRunFilesFromCases(cases: readonly TestPlan['cases'][number][]): readonly CollectedRunFile[] {
    const files = new Map<string, TestPlan['cases'][number][]>();

    for (const testCase of cases) {
        const file = testCase.id.file ?? '';
        files.set(file, [ ...files.get(file) ?? [], testCase ]);
    }

    return Array.from(files, function collectFile([ file, fileCases ]) {
        return collectRunPlanFile(file, fileCases);
    });
}

export function collectedRunPlanFromTestPlanCases(
    testPlan: TestPlan,
    cases: readonly TestPlan['cases'][number][]
): CollectedRunPlan {
    return {
        defined: testPlan.defined,
        discoveredFiles: collectedRunFilesFromCases(testPlan.discoveredCases),
        files: collectedRunFilesFromCases(cases),
        orphans: testPlan.orphans,
        root: {
            metadata: testPlan.root.metadata,
            name: testPlan.root.name
        }
    };
}

export function collectedRunPlanFromTestPlan(testPlan: TestPlan): CollectedRunPlan {
    return collectedRunPlanFromTestPlanCases(testPlan, testPlan.cases);
}

export function collectedRunCaseFacts(plan: CollectedRunPlan): readonly RunCaseFacts[] {
    return collectedCases(plan.files).map(function toRunCaseFacts(collectedCase): RunCaseFacts {
        return {
            id: collectedCaseId(collectedCase.file, collectedCase.testCase),
            metadata: serializeValue(collectedCase.testCase.metadata)
        };
    });
}

export function collectedRunCaseIds(plan: CollectedRunPlan): readonly CaseId[] {
    return collectedCases(plan.files).map(function toCaseId(collectedCase) {
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
