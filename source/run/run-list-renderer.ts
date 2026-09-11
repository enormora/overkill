import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import {
    createReportingContext,
    formatDefinitionLocations,
    formatSourceLocation,
    type ReportingContext
} from '../engine/reporting-context.ts';
import type { OrphanedNode } from '../engine/run-result.ts';
import { caseIdentityKey } from '../engine/identity.ts';
import {
    collectedRunCaseEntries,
    collectedRunPlanFromTestPlan,
    type CollectedRunCaseEntry
} from './collected-run-plan.ts';
import type { CollectedRunCase, CollectedRunFile, CollectedRunPlan, ResolvedRun } from './run-types.ts';

type RenderOptions = {
    readonly withLocations: boolean;
    readonly withOrphans: boolean;
};

type NodeLineInput = {
    readonly context: ReportingContext;
    readonly depth: number;
    readonly locations: readonly SourceLocation[];
    readonly name: string;
    readonly options: RenderOptions;
};
type RenderCaseEntriesState = {
    readonly currentFile: string | null;
    readonly currentSuitePath: CollectedRunCase['suitePath'];
    readonly lines: readonly string[];
};

const indentation = '  ';
const orphanDetailDepth = 2;

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

function locationSuffix(location: SourceLocation, options: RenderOptions, context: ReportingContext): string {
    const renderedLocation = options.withLocations ? formatSourceLocation(location, context) : null;

    return renderedLocation === null ? '' : ` (${renderedLocation})`;
}

function formatDefinitionLocationDetails(
    locations: readonly SourceLocation[],
    options: RenderOptions,
    context: ReportingContext,
    depth: number
): readonly string[] {
    if (!options.withLocations || locations.length <= 1) {
        return [];
    }

    const sourceLocations = formatDefinitionLocations(locations, context);

    return sourceLocations.details.map(function renderLocation(detail) {
        return `${indent(depth)}${detail}`;
    });
}

function formatNodeLines(input: NodeLineInput): readonly string[] {
    const primaryLocation = input.locations[0];
    const primaryLine = primaryLocation === undefined
        ? input.name
        : `${input.name}${locationSuffix(primaryLocation, input.options, input.context)}`;

    return [
        `${indent(input.depth)}${primaryLine}`,
        ...formatDefinitionLocationDetails(input.locations, input.options, input.context, input.depth + 1)
    ];
}

function renderSuiteLines(
    sharedLength: number,
    suitePath: CollectedRunCase['suitePath'],
    options: RenderOptions,
    context: ReportingContext
): readonly string[] {
    const lines: string[] = [];

    for (let index = sharedLength; index < suitePath.length; index += 1) {
        const entry = suitePath[index];

        if (entry !== undefined) {
            lines.push(...formatNodeLines({
                context,
                depth: index + 1,
                locations: entry.definitionLocations,
                name: entry.title,
                options
            }));
        }
    }

    return lines;
}

function renderFile(file: CollectedRunFile, options: RenderOptions, context: ReportingContext): readonly string[] {
    const lines: string[] = [ file.file ];
    let currentSuitePath: CollectedRunCase['suitePath'] = [];

    for (const testCase of file.cases) {
        const sharedLength = sharedPrefixLength(currentSuitePath, testCase.suitePath);

        lines.push(
            ...renderSuiteLines(sharedLength, testCase.suitePath, options, context),
            ...formatNodeLines({
                context,
                depth: testCase.suitePath.length + 1,
                locations: testCase.definitionLocations,
                name: formatCaseName(testCase),
                options
            })
        );
        currentSuitePath = testCase.suitePath;
    }

    return lines;
}

function renderCaseEntry(
    testCase: CollectedRunCaseEntry,
    currentSuitePath: CollectedRunCase['suitePath'],
    options: RenderOptions,
    context: ReportingContext
): readonly string[] {
    const sharedLength = sharedPrefixLength(currentSuitePath, testCase.testCase.suitePath);

    return [
        ...renderSuiteLines(sharedLength, testCase.testCase.suitePath, options, context),
        ...formatNodeLines({
            context,
            depth: testCase.testCase.suitePath.length + 1,
            locations: testCase.testCase.definitionLocations,
            name: formatCaseName(testCase.testCase),
            options
        })
    ];
}

function appendRenderedCaseEntry(
    state: RenderCaseEntriesState,
    testCase: CollectedRunCaseEntry,
    options: RenderOptions,
    context: ReportingContext
): RenderCaseEntriesState {
    const sameFile = testCase.file === state.currentFile;
    const currentSuitePath = sameFile ? state.currentSuitePath : [];
    const lines = sameFile ? state.lines : [ ...state.lines, testCase.file ];

    return {
        currentFile: testCase.file,
        currentSuitePath: testCase.testCase.suitePath,
        lines: [ ...lines, ...renderCaseEntry(testCase, currentSuitePath, options, context) ]
    };
}

function renderCaseEntries(
    cases: readonly CollectedRunCaseEntry[],
    options: RenderOptions,
    context: ReportingContext
): readonly string[] {
    const initialState: RenderCaseEntriesState = {
        currentFile: null,
        currentSuitePath: [],
        lines: []
    };

    return cases
        .reduce(function renderCaseEntryLines(state, testCase) {
            return appendRenderedCaseEntry(state, testCase, options, context);
        }, initialState)
        .lines;
}

function renderOrphan(orphan: OrphanedNode, options: RenderOptions, context: ReportingContext): readonly string[] {
    const file = orphan.file ?? '<unknown>';

    return [
        `${indent(1)}${orphan.kind}: ${orphan.title} (${file})${
            locationSuffix(orphan.definitionLocations[0], options, context)
        }`,
        ...formatDefinitionLocationDetails(orphan.definitionLocations, options, context, orphanDetailDepth)
    ];
}

function renderOrphans(
    orphans: readonly OrphanedNode[],
    options: RenderOptions,
    context: ReportingContext
): readonly string[] {
    if (orphans.length === 0) {
        return [ 'Orphans', `${indent(1)}(none)` ];
    }

    return [
        'Orphans',
        ...orphans.flatMap(function renderOrphanLine(orphan) {
            return renderOrphan(orphan, options, context);
        })
    ];
}

function resolvedCollectedPlan(resolvedRun: ResolvedRun): CollectedRunPlan {
    if (resolvedRun.plan.kind === 'supervised' || resolvedRun.plan.kind === 'worker-pool') {
        return resolvedRun.plan.collectedPlan;
    }

    return collectedRunPlanFromTestPlan(resolvedRun.plan.testPlan);
}

function factsCaseEntries(resolvedRun: ResolvedRun, plan: CollectedRunPlan): readonly CollectedRunCaseEntry[] | null {
    const { cases: factsCases } = resolvedRun.facts;

    const casesByKey = new Map(
        collectedRunCaseEntries(plan).map(function toEntry(testCase) {
            return [ caseIdentityKey(testCase.id), testCase ];
        })
    );

    const entries = factsCases.flatMap(function toOrderedCase(testCase) {
        const entry = casesByKey.get(caseIdentityKey(testCase.id));

        return entry === undefined ? [] : [ entry ];
    });

    return entries.length === factsCases.length ? entries : null;
}

function planLines(
    resolvedRun: ResolvedRun,
    plan: CollectedRunPlan,
    options: RenderOptions,
    context: ReportingContext
): readonly string[] {
    const orderedCases = factsCaseEntries(resolvedRun, plan);

    if (orderedCases === null) {
        return plan.files.flatMap(function renderPlanFile(file) {
            return renderFile(file, options, context);
        });
    }

    return renderCaseEntries(orderedCases, options, context);
}

function orderSummary(resolvedRun: ResolvedRun): readonly string[] {
    const { execution, reproducibility } = resolvedRun.facts;

    return [ `order=${execution.order} seed=${reproducibility.seed}` ];
}

export function renderResolvedRunList(resolvedRun: ResolvedRun, options: RenderOptions): readonly string[] {
    const plan = resolvedCollectedPlan(resolvedRun);
    const context = createReportingContext({
        projectRoot: resolvedRun.facts.environment.projectRoot
    });
    const renderedPlan = [
        ...orderSummary(resolvedRun),
        ...planLines(resolvedRun, plan, options, context)
    ];

    if (!options.withOrphans) {
        return renderedPlan;
    }

    return [ ...renderedPlan, ...renderOrphans(plan.orphans, options, context) ];
}
