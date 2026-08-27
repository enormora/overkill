import type { OrphanedNode } from '../engine/run-result.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import type { CollectedRunCase, CollectedRunFile, CollectedRunPlan, ResolvedRun } from './run-types.ts';

type RenderOptions = {
    readonly withOrphans: boolean;
};

function indent(depth: number): string {
    return '  '.repeat(depth);
}

function sharedPrefixLength(left: readonly string[], right: readonly string[]): number {
    let length = 0;

    while (left[length] !== undefined && left[length] === right[length]) {
        length += 1;
    }

    return length;
}

function formatCaseName(testCase: CollectedRunCase): string {
    if (testCase.params === null) {
        return testCase.name;
    }

    return `${testCase.name} [${testCase.params}]`;
}

function renderSuiteLines(sharedLength: number, suite: readonly string[]): readonly string[] {
    const lines: string[] = [];

    for (let index = sharedLength; index < suite.length; index += 1) {
        const suiteName = suite[index];

        if (suiteName !== undefined) {
            lines.push(`${indent(index + 1)}${suiteName}`);
        }
    }

    return lines;
}

function renderFile(file: CollectedRunFile): readonly string[] {
    const lines: string[] = [ file.file ];
    let currentSuite: readonly string[] = [];

    for (const testCase of file.cases) {
        const sharedLength = sharedPrefixLength(currentSuite, testCase.suite);

        lines.push(
            ...renderSuiteLines(sharedLength, testCase.suite),
            `${indent(testCase.suite.length + 1)}${formatCaseName(testCase)}`
        );
        currentSuite = testCase.suite;
    }

    return lines;
}

function renderOrphan(orphan: OrphanedNode): string {
    return `${indent(1)}${orphan.kind}: ${orphan.name} (${orphan.file ?? '<unknown>'})`;
}

function renderOrphans(orphans: readonly OrphanedNode[]): readonly string[] {
    if (orphans.length === 0) {
        return [ 'Orphans', `${indent(1)}(none)` ];
    }

    return [ 'Orphans', ...orphans.map(renderOrphan) ];
}

function resolvedCollectedPlan(resolvedRun: ResolvedRun): CollectedRunPlan {
    if (resolvedRun.plan.kind === 'supervised') {
        return resolvedRun.plan.collectedPlan;
    }

    return collectedRunPlanFromTestPlan(resolvedRun.plan.testPlan);
}

export function renderResolvedRunList(resolvedRun: ResolvedRun, options: RenderOptions): readonly string[] {
    const plan = resolvedCollectedPlan(resolvedRun);
    const planLines = plan.files.flatMap(renderFile);

    if (!options.withOrphans) {
        return planLines;
    }

    return [ ...planLines, ...renderOrphans(plan.orphans) ];
}
