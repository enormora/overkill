import { serializeValue } from '../compare/serialized-value.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import { testCasePropertyPolicy } from './property-collection.ts';
import type { CollectedRunCase, RunCaseFacts } from './run-types.ts';

export type RunCaseFileSet = (file: RunCaseFacts['id']['file']) => string | null;

type CollectedCaseFactsInput = {
    readonly id: RunCaseFacts['id'];
    readonly workId: RunCaseFacts['workId'];
    readonly testCase: Pick<CollectedRunCase, 'annotations' | 'controls' | 'property'>;
};

export function caseDataFacts(
    testCase: Pick<TestPlanCase, 'annotations' | 'controls'>
): Pick<RunCaseFacts, 'annotations' | 'controls'> {
    return { annotations: serializeValue(testCase.annotations), controls: serializeValue(testCase.controls) };
}

export function runCaseFactsFromTestPlan(testPlan: TestPlan, fileSetForCase: RunCaseFileSet): readonly RunCaseFacts[] {
    return testPlan.cases.map(function caseFacts(testCase) {
        return {
            ...caseDataFacts(testCase),
            propertyPolicy: testCasePropertyPolicy(testCase),
            fileSet: fileSetForCase(testCase.id.file),
            id: testCase.id,
            workId: testCase.workId
        };
    });
}

export function collectedRunCaseFactsFromEntries(
    cases: readonly CollectedCaseFactsInput[],
    fileSetForCase: RunCaseFileSet
): readonly RunCaseFacts[] {
    return cases.map(function caseFacts(entry) {
        return {
            ...caseDataFacts(entry.testCase),
            propertyPolicy: entry.testCase.property?.policy ?? null,
            fileSet: fileSetForCase(entry.id.file),
            id: entry.id,
            workId: entry.workId
        };
    });
}
