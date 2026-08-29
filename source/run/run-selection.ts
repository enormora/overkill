import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createCaseId, type CaseId } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import { noTestsCollected } from './run-errors.ts';
import { matchesRunFilter } from './run-selection-filters.ts';
import type {
    CollectedRunCase,
    CollectedRunFile,
    CollectedRunPlan,
    RunSelection
} from './run-types.ts';

export type SelectedRunCases<Case> = {
    readonly discoveredCases: NonEmptyReadonlyArray<Case>;
    readonly plannedCases: readonly Case[];
};

type CollectedCaseInput = {
    readonly file: string;
    readonly testCase: CollectedRunCase;
};

function selectedCases<Case>(
    cases: NonEmptyReadonlyArray<Case>,
    selection: RunSelection,
    matchesCase: (testCase: Case) => boolean
): SelectedRunCases<Case> {
    if (selection.kind === 'all') {
        return {
            discoveredCases: cases,
            plannedCases: cases
        };
    }

    return {
        discoveredCases: cases,
        plannedCases: cases.filter(matchesCase)
    };
}

function matchesTestPlanCase(selection: RunSelection): (testCase: TestPlanCase) => boolean {
    if (selection.kind === 'all') {
        return function keepAllCases() {
            return true;
        };
    }

    return function testPlanCaseMatches(testCase) {
        return matchesRunFilter(selection.filter, {
            id: testCase.id,
            metadata: testCase.metadata
        });
    };
}

export function selectedTestPlanCases(testPlan: TestPlan, selection: RunSelection): SelectedRunCases<TestPlanCase> {
    return selectedCases(testPlan.discoveredCases, selection, matchesTestPlanCase(selection));
}

export function selectedTestPlan(testPlan: TestPlan, selection: RunSelection): TestPlan {
    const selectionResult = selectedTestPlanCases(testPlan, selection);
    const firstCase = selectionResult.plannedCases[0];

    if (firstCase === undefined) {
        noTestsCollected('Run selection matched no test cases.');
    }

    return {
        ...testPlan,
        cases: [ firstCase, ...selectionResult.plannedCases.slice(1) ]
    };
}

function collectedCaseId(file: string, testCase: CollectedRunCase): CaseId {
    return createCaseId(file, testCase.suite, testCase.name, testCase.params);
}

function collectedCases(files: readonly CollectedRunFile[]): readonly CollectedCaseInput[] {
    return files.flatMap(function collectFileCases(file) {
        return file.cases.map(function collectCase(testCase) {
            return {
                file: file.file,
                testCase
            };
        });
    });
}

function matchesCollectedCase(selection: RunSelection): (input: CollectedCaseInput) => boolean {
    if (selection.kind === 'all') {
        return function keepAllCases() {
            return true;
        };
    }

    return function collectedCaseMatches(input) {
        return matchesRunFilter(selection.filter, {
            id: collectedCaseId(input.file, input.testCase),
            metadata: input.testCase.metadata
        });
    };
}

function collectedRunFile(file: string, cases: readonly CollectedRunCase[]): CollectedRunFile | null {
    if (cases.length === 0) {
        return null;
    }

    return { cases, file };
}

function collectedRunFiles(cases: readonly CollectedCaseInput[]): readonly CollectedRunFile[] {
    return Array
        .from(Map.groupBy(cases, function groupByFile(input) {
            return input.file;
        }))
        .flatMap(function toCollectedFile([ file, fileCases ]) {
            const plannedFile = collectedRunFile(
                file,
                fileCases.map(function toTestCase(input) {
                    return input.testCase;
                })
            );

            return plannedFile === null ? [] : [ plannedFile ];
        });
}

export function selectedCollectedRunPlan(plan: CollectedRunPlan, selection: RunSelection): CollectedRunPlan {
    const discoveredCases = collectedCases(plan.discoveredFiles);
    const plannedCases = selection.kind === 'all'
        ? discoveredCases
        : discoveredCases.filter(matchesCollectedCase(selection));

    return {
        ...plan,
        files: collectedRunFiles(plannedCases)
    };
}

export function assertCollectedRunPlanHasCases(plan: CollectedRunPlan): void {
    if (
        plan.files.every(function fileHasNoCases(file) {
            return file.cases.length === 0;
        })
    ) {
        noTestsCollected('Run selection matched no test cases.');
    }
}
