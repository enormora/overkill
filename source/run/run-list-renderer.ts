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

const indentation = '  ';
const orphanDetailDepth = 2;
const secondToLastOffset = 2;

function indent(depth: number): string {
    return indentation.repeat(depth);
}

function sharedPrefixLength(left: CollectedRunCase['suitePath'], right: CollectedRunCase['suitePath']): number {
    let length = 0;

    while (left[length] !== undefined && left[length]?.title === right[length]?.title) {
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

function formatDefinitionLocationDetails(
    locations: readonly SourceLocation[],
    options: RenderOptions,
    depth: number
): readonly string[] {
    if (!options.withLocations || locations.length <= 1) {
        return [];
    }

    return locations.slice(1).flatMap(function renderLocation(location, index) {
        const renderedLocation = formatLocation(location, options.cwd);

        if (renderedLocation === null) {
            return [];
        }

        const label = index === locations.length - secondToLastOffset ? 'constructed at' : 'expanded at';

        return [ `${indent(depth)}${label} ${renderedLocation}` ];
    });
}

function formatNodeLines(
    name: string,
    locations: readonly SourceLocation[],
    options: RenderOptions,
    depth: number
): readonly string[] {
    const primaryLocation = locations[0];
    const primaryLine = primaryLocation === undefined
        ? name
        : `${name}${locationSuffix(primaryLocation, options)}`;

    return [
        `${indent(depth)}${primaryLine}`,
        ...formatDefinitionLocationDetails(locations, options, depth + 1)
    ];
}

function renderSuiteLines(
    sharedLength: number,
    suitePath: CollectedRunCase['suitePath'],
    options: RenderOptions
): readonly string[] {
    const lines: string[] = [];

    for (let index = sharedLength; index < suitePath.length; index += 1) {
        const entry = suitePath[index];

        if (entry !== undefined) {
            lines.push(...formatNodeLines(entry.title, entry.definitionLocations, options, index + 1));
        }
    }

    return lines;
}

function renderFile(file: CollectedRunFile, options: RenderOptions): readonly string[] {
    const lines: string[] = [ file.file ];
    let currentSuitePath: CollectedRunCase['suitePath'] = [];

    for (const testCase of file.cases) {
        const sharedLength = sharedPrefixLength(currentSuitePath, testCase.suitePath);

        lines.push(
            ...renderSuiteLines(sharedLength, testCase.suitePath, options),
            ...formatNodeLines(
                formatCaseName(testCase),
                testCase.definitionLocations,
                options,
                testCase.suitePath.length + 1
            )
        );
        currentSuitePath = testCase.suitePath;
    }

    return lines;
}

function renderOrphan(orphan: OrphanedNode, options: RenderOptions): readonly string[] {
    const file = orphan.file ?? '<unknown>';

    return [
        `${indent(1)}${orphan.kind}: ${orphan.title} (${file})${
            locationSuffix(orphan.definitionLocations[0], options)
        }`,
        ...formatDefinitionLocationDetails(orphan.definitionLocations, options, orphanDetailDepth)
    ];
}

function renderOrphans(orphans: readonly OrphanedNode[], options: RenderOptions): readonly string[] {
    if (orphans.length === 0) {
        return [ 'Orphans', `${indent(1)}(none)` ];
    }

    return [
        'Orphans',
        ...orphans.flatMap(function renderOrphanLine(orphan) {
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
