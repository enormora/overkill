import type { WallClock } from '@enormora/wall-clock';
import { serializeValue } from '../compare/serialized-value.ts';
import { createCaseId, createDefaultWorkId, workIdentityKey, type CaseId, type WorkId } from '../engine/identity.ts';
import {
    runStatusFromPlan,
    type PerTestResult,
    type RunPlanStatus,
    type RunResourceUsage,
    type RunResult,
    type RunnerError
} from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type {
    CollectedRunCase,
    CollectedRunFile,
    CollectedRunPlan,
    RunCaseFacts
} from './run-types.ts';
import type { RunCaseFileSet } from './run-facts.ts';

function suiteTitles(suitePath: TestPlan['cases'][number]['suitePath']): readonly string[] {
    return suitePath.map(function toTitle(entry) {
        return entry.title;
    });
}

type RunResultTiming = {
    readonly planStatus: RunPlanStatus;
    readonly resourceUsage: RunResourceUsage | null;
    readonly startedAtMs: number;
    readonly wallClock: WallClock;
};

export type CollectedRunCaseEntry = {
    readonly file: string;
    readonly id: CaseId;
    readonly testCase: CollectedRunCase;
    readonly workId: WorkId;
};

function collectedCaseId(file: string, testCase: CollectedRunCase): CaseId {
    return createCaseId(file, suiteTitles(testCase.suitePath), testCase.title, testCase.params);
}

function collectedCaseWorkId(file: string, testCase: CollectedRunCase): WorkId {
    return testCase.workId ?? createDefaultWorkId(collectedCaseId(file, testCase));
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
        return workIdentityKey(testResult.workId);
    }));

    for (const collectedCase of collectedCases(plan.discoveredFiles)) {
        counts = countSuitePath(counts, suiteTitles(collectedCase.testCase.suitePath), 'discovered');
    }

    for (const collectedCase of collectedCases(plan.files)) {
        counts = countSuitePath(counts, suiteTitles(collectedCase.testCase.suitePath), 'planned');

        if (executedIds.has(workIdentityKey(collectedCaseWorkId(collectedCase.file, collectedCase.testCase)))) {
            counts = countSuitePath(counts, suiteTitles(collectedCase.testCase.suitePath), 'executed');
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
                annotations: testCase.annotations,
                controls: testCase.controls,
                definitionLocations: testCase.definitionLocations,
                params: testCase.id.params,
                resourceAttachments: testCase.resourceAttachments,
                suitePath: testCase.suitePath,
                testFamily: testCase.testFamily,
                title: testCase.id.title,
                workId: testCase.workId
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
            annotations: testPlan.root.annotations,
            controls: testPlan.root.controls,
            title: testPlan.root.title
        }
    };
}

export function collectedRunPlanFromTestPlan(testPlan: TestPlan): CollectedRunPlan {
    return collectedRunPlanFromTestPlanCases(testPlan, testPlan.cases);
}

export function collectedRunCaseEntries(plan: CollectedRunPlan): readonly CollectedRunCaseEntry[] {
    return collectedCases(plan.files).map(function toCaseEntry(collectedCase) {
        const id = collectedCaseId(collectedCase.file, collectedCase.testCase);

        return {
            ...collectedCase,
            annotations: serializeValue(collectedCase.testCase.annotations),
            controls: serializeValue(collectedCase.testCase.controls),
            id,
            workId: collectedCaseWorkId(collectedCase.file, collectedCase.testCase)
        };
    });
}

function fileEntryKey(entry: CollectedRunCaseEntry): string {
    return entry.file;
}

function collectedRunFileFromEntries(
    file: string,
    entries: readonly CollectedRunCaseEntry[]
): CollectedRunFile {
    return {
        cases: entries.map(function toCollectedCase(entry) {
            return entry.testCase;
        }),
        file
    };
}

export function collectedRunPlanFromEntries(
    plan: CollectedRunPlan,
    entries: readonly CollectedRunCaseEntry[]
): CollectedRunPlan {
    return {
        ...plan,
        files: Array.from(
            Map.groupBy(entries, fileEntryKey),
            function toCollectedFile([ file, fileEntries ]) {
                return collectedRunFileFromEntries(file, fileEntries);
            }
        )
    };
}

export function collectedRunCaseFactsFromEntries(
    cases: readonly CollectedRunCaseEntry[],
    fileSetForCase: RunCaseFileSet
): readonly RunCaseFacts[] {
    return cases.map(function toRunCaseFacts(collectedCase): RunCaseFacts {
        return {
            annotations: serializeValue(collectedCase.testCase.annotations),
            controls: serializeValue(collectedCase.testCase.controls),
            fileSet: fileSetForCase(collectedCase.id.file),
            id: collectedCase.id,
            workId: collectedCase.workId
        };
    });
}

export function createRunResultFromCollectedPlan(
    plan: CollectedRunPlan,
    perTest: readonly PerTestResult[],
    runnerErrors: readonly RunnerError[],
    timing: RunResultTiming
): RunResult {
    const summary = countOutcomes(plan, perTest);

    return {
        artifacts: [],
        bySuite: countSuites(plan, perTest),
        orphans: plan.orphans,
        perTest,
        planStatus: timing.planStatus,
        resourceUsage: timing.resourceUsage,
        runnerErrors,
        status: runStatusFromPlan(summary, runnerErrors, timing.planStatus),
        summary,
        wallTimeMs: timing.wallClock.currentTimestampInMilliseconds - timing.startedAtMs
    };
}
