import { isAbsolute, relative } from 'node:path';
import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { OrphanedNode } from '../engine/run-result.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import type { CollectedRunCase, CollectedRunFile, CollectedRunPlan, ResolvedRun } from './run-types.ts';

type RenderOptions = {
    readonly cwd: string;
    readonly withLocations: boolean;
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
    return testCase.params === null ? testCase.title : `${testCase.title} [${testCase.params}]`;
}

function formatLocationPath(file: string, cwd: string): string {
    if (!isAbsolute(file)) {
        return file;
    }

    const relativeFile = relative(cwd, file);

    return relativeFile.length > 0 && !relativeFile.startsWith('..') && !isAbsolute(relativeFile)
        ? relativeFile
        : file;
}

function formatLocation(location: SourceLocation, cwd: string): string | null {
    if (location.file.length === 0) {
        return null;
    }

    const file = formatLocationPath(location.file, cwd);

    if (location.line === null) {
        return file;
    }

    if (location.column === null) {
        return `${file}:${location.line}`;
    }

    return `${file}:${location.line}:${location.column}`;
}

function locationSuffix(location: SourceLocation, options: RenderOptions): string {
    const renderedLocation = options.withLocations ? formatLocation(location, options.cwd) : null;

    return renderedLocation === null ? '' : ` (${renderedLocation})`;
}

function formatNodeLine(name: string, location: SourceLocation, options: RenderOptions): string {
    return `${name}${locationSuffix(location, options)}`;
}

function renderSuiteLines(
    sharedLength: number,
    suite: readonly string[],
    locations: readonly SourceLocation[],
    options: RenderOptions
): readonly string[] {
    const lines: string[] = [];

    for (let index = sharedLength; index < suite.length; index += 1) {
        const suiteName = suite[index];
        const location = locations[index];

        if (suiteName !== undefined && location !== undefined) {
            lines.push(`${indent(index + 1)}${formatNodeLine(suiteName, location, options)}`);
        }
    }

    return lines;
}

function renderFile(file: CollectedRunFile, options: RenderOptions): readonly string[] {
    const lines: string[] = [ file.file ];
    let currentSuite: readonly string[] = [];

    for (const testCase of file.cases) {
        const sharedLength = sharedPrefixLength(currentSuite, testCase.suite);

        lines.push(
            ...renderSuiteLines(sharedLength, testCase.suite, testCase.suiteDefinitionLocations, options),
            `${indent(testCase.suite.length + 1)}${
                formatNodeLine(formatCaseName(testCase), testCase.definitionLocation, options)
            }`
        );
        currentSuite = testCase.suite;
    }

    return lines;
}

function renderOrphan(orphan: OrphanedNode, options: RenderOptions): string {
    const file = orphan.file ?? '<unknown>';

    return `${indent(1)}${orphan.kind}: ${orphan.title} (${file})${locationSuffix(orphan.definitionLocation, options)}`;
}

function renderOrphans(orphans: readonly OrphanedNode[], options: RenderOptions): readonly string[] {
    if (orphans.length === 0) {
        return [ 'Orphans', `${indent(1)}(none)` ];
    }

    return [
        'Orphans',
        ...orphans.map(function renderOrphanLine(orphan) {
            return renderOrphan(orphan, options);
        })
    ];
}

function resolvedCollectedPlan(resolvedRun: ResolvedRun): CollectedRunPlan {
    if (resolvedRun.plan.kind === 'supervised') {
        return resolvedRun.plan.collectedPlan;
    }

    return collectedRunPlanFromTestPlan(resolvedRun.plan.testPlan);
}

export function renderResolvedRunList(resolvedRun: ResolvedRun, options: RenderOptions): readonly string[] {
    const plan = resolvedCollectedPlan(resolvedRun);
    const planLines = plan.files.flatMap(function renderPlanFile(file) {
        return renderFile(file, options);
    });

    if (!options.withOrphans) {
        return planLines;
    }

    return [ ...planLines, ...renderOrphans(plan.orphans, options) ];
}
