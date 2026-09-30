import { posix as path } from 'node:path';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { caseIdentityKey, type CaseId, type WorkId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { RunFilter, RunSelection, RunStringFilterField } from './run-request-types.ts';

type RunFilterCandidate = {
    readonly annotations: TestPlanCase['annotations'];
    readonly id: CaseId;
    readonly workId: WorkId;
};

type CandidateFieldReaders = Readonly<
    Record<RunStringFilterField, (candidate: RunFilterCandidate) => readonly string[]>
>;

type CaseIdFieldValidator = (id: Readonly<Record<string, unknown>>) => string | null;
type FilterNodeValidator = (filter: Readonly<Record<string, unknown>>) => string | null;

const filterFields: ReadonlySet<string> = new Set([
    'file',
    'owner',
    'params',
    'suite',
    'tag',
    'title'
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRunStringFilterField(value: unknown): value is RunStringFilterField {
    return typeof value === 'string' && filterFields.has(value);
}

function assertNonEmptyString(value: string, label: string): void {
    if (value.trim().length === 0) {
        throw new TypeError(`${label} must not be empty.`);
    }
}

function assertNonEmptyFilters(filters: readonly RunFilter[]): NonEmptyReadonlyArray<RunFilter> {
    const [ firstFilter, ...remainingFilters ] = filters;

    if (firstFilter === undefined) {
        throw new TypeError('Composite run filters must contain at least one child filter.');
    }

    return [ firstFilter, ...remainingFilters ];
}

function copyCaseId(id: CaseId): CaseId {
    return {
        file: id.file,
        params: id.params,
        suite: Array.from(id.suite),
        title: id.title
    };
}

export function all(filters: NonEmptyReadonlyArray<RunFilter>): RunFilter {
    return {
        filters: assertNonEmptyFilters(Array.from(filters)),
        kind: 'all'
    };
}

export function any(filters: NonEmptyReadonlyArray<RunFilter>): RunFilter {
    return {
        filters: assertNonEmptyFilters(Array.from(filters)),
        kind: 'any'
    };
}

export function not(filter: RunFilter): RunFilter {
    return { filter, kind: 'not' };
}

export function caseId(id: CaseId): RunFilter {
    return {
        id: copyCaseId(id),
        kind: 'case-id'
    };
}

export function equals(field: RunStringFilterField, value: string): RunFilter {
    assertNonEmptyString(value, 'Run filter value');

    return { field, kind: 'equals', value };
}

export function contains(field: RunStringFilterField, value: string): RunFilter {
    assertNonEmptyString(value, 'Run filter value');

    return { field, kind: 'contains', value };
}

export function glob(field: RunStringFilterField, pattern: string): RunFilter {
    assertNonEmptyString(pattern, 'Run filter glob pattern');

    return { field, kind: 'glob', pattern };
}

export function file(pattern: string): RunFilter {
    return glob('file', pattern);
}

export function owner(value: string): RunFilter {
    return equals('owner', value);
}

export function params(value: string): RunFilter {
    return contains('params', value);
}

export function suite(value: string): RunFilter {
    return contains('suite', value);
}

export function tag(value: string): RunFilter {
    return equals('tag', value);
}

export function title(value: string): RunFilter {
    return contains('title', value);
}

export function runtime(name: string): RunFilter {
    assertNonEmptyString(name, 'Runtime filter name');

    return { kind: 'runtime', runtime: name };
}

export function runtimeVariant(name: string, variantId: string): RunFilter {
    assertNonEmptyString(name, 'Runtime variant filter name');
    assertNonEmptyString(variantId, 'Runtime variant filter variant id');

    return { kind: 'runtime-variant', runtime: name, variantId };
}

export function runtimeDimension(name: string, dimension: string, value: string): RunFilter {
    assertNonEmptyString(name, 'Runtime dimension filter name');
    assertNonEmptyString(dimension, 'Runtime dimension filter dimension');
    assertNonEmptyString(value, 'Runtime dimension filter value');

    return { dimension, kind: 'runtime-dimension', runtime: name, value };
}

export function runtimeScenario(name: string, scenario: string, value: string): RunFilter {
    assertNonEmptyString(name, 'Runtime scenario filter runtime');
    assertNonEmptyString(scenario, 'Runtime scenario filter scenario');
    assertNonEmptyString(value, 'Runtime scenario filter value');

    return { kind: 'runtime-scenario', runtime: name, scenario, value };
}

function hasInvalidSuiteItem(value: unknown): boolean {
    return !Array.isArray(value) || value.some(function emptySuiteItem(item) {
        return typeof item !== 'string' || item.trim().length === 0;
    });
}

const caseIdFieldValidators: readonly CaseIdFieldValidator[] = [
    function invalidCaseFile(id) {
        if (typeof id.file !== 'string' && id.file !== null) {
            return 'Run filter case id file must be a string or null.';
        }

        return null;
    },
    function invalidCaseTitle(id) {
        if (typeof id.title !== 'string' || id.title.trim().length === 0) {
            return 'Run filter case id title must be a non-empty string.';
        }

        return null;
    },
    function invalidCaseParams(id) {
        if (typeof id.params !== 'string' && id.params !== null) {
            return 'Run filter case id params must be a string or null.';
        }

        return null;
    },
    function invalidCaseSuite(id) {
        if (hasInvalidSuiteItem(id.suite)) {
            return 'Run filter case id suite must contain non-empty strings.';
        }

        return null;
    }
];

function invalidCaseIdFieldMessage(id: Readonly<Record<string, unknown>>): string | null {
    for (const validateField of caseIdFieldValidators) {
        const message = validateField(id);

        if (message !== null) {
            return message;
        }
    }

    return null;
}

function invalidCaseIdMessage(id: unknown): string | null {
    if (!isRecord(id)) {
        return 'Run filter case id must be an object.';
    }

    return invalidCaseIdFieldMessage(id);
}

function invalidStringFilterMessage(
    filter: Readonly<Record<string, unknown>>,
    valueField: 'pattern' | 'value'
): string | null {
    if (!isRunStringFilterField(filter.field)) {
        return 'Run filter field is unknown.';
    }

    if (typeof filter[valueField] !== 'string' || filter[valueField].trim().length === 0) {
        return `Run filter ${valueField} must be a non-empty string.`;
    }

    return null;
}

function invalidCompositeFilterMessage(filter: Readonly<Record<string, unknown>>): string | null {
    if (!Array.isArray(filter.filters) || filter.filters.length === 0) {
        return 'Composite run filters must contain at least one child filter.';
    }

    return null;
}

const runtimeFilterLabels: Readonly<Record<string, string>> = {
    runtime: 'Runtime filter',
    'runtime-dimension': 'Runtime dimension filter',
    'runtime-scenario': 'Runtime scenario filter',
    'runtime-variant': 'Runtime variant filter'
};

function invalidRuntimeFieldsMessage(
    filter: Readonly<Record<string, unknown>>,
    fields: readonly string[]
): string | null {
    const label = typeof filter.kind === 'string' ? runtimeFilterLabels[filter.kind] : undefined;

    for (const field of fields) {
        const value = filter[field];

        if (typeof value !== 'string' || value.trim().length === 0) {
            return `${label ?? 'Runtime filter'} ${field} must be a non-empty string.`;
        }
    }

    return null;
}

const filterNodeValidators: Readonly<Record<string, FilterNodeValidator>> = {
    all: invalidCompositeFilterMessage,
    any: invalidCompositeFilterMessage,
    'case-id': function invalidCaseIdFilter(filter) {
        return invalidCaseIdMessage(filter.id);
    },
    contains: function invalidContainsFilter(filter) {
        return invalidStringFilterMessage(filter, 'value');
    },
    equals: function invalidEqualsFilter(filter) {
        return invalidStringFilterMessage(filter, 'value');
    },
    glob: function invalidGlobFilter(filter) {
        return invalidStringFilterMessage(filter, 'pattern');
    },
    not: function invalidNotFilter(filter) {
        return isRecord(filter.filter) ? null : 'Run filter must be an object.';
    },
    runtime: function invalidRuntimeFilter(filter) {
        return invalidRuntimeFieldsMessage(filter, [ 'runtime' ]);
    },
    'runtime-dimension': function invalidRuntimeDimensionFilter(filter) {
        return invalidRuntimeFieldsMessage(filter, [ 'runtime', 'dimension', 'value' ]);
    },
    'runtime-scenario': function invalidRuntimeScenarioFilter(filter) {
        return invalidRuntimeFieldsMessage(filter, [ 'runtime', 'scenario', 'value' ]);
    },
    'runtime-variant': function invalidRuntimeVariantFilter(filter) {
        return invalidRuntimeFieldsMessage(filter, [ 'runtime', 'variantId' ]);
    }
};

function invalidKnownFilterMessage(filter: Readonly<Record<string, unknown>>): string | null {
    const validate = typeof filter.kind === 'string' ? filterNodeValidators[filter.kind] : undefined;

    return validate === undefined ? 'Run filter kind is unknown.' : validate(filter);
}

function filterChildren(filter: Readonly<Record<string, unknown>>): readonly unknown[] {
    if ((filter.kind === 'all' || filter.kind === 'any') && Array.isArray(filter.filters)) {
        return filter.filters;
    }

    return filter.kind === 'not' ? [ filter.filter ] : [];
}

function invalidFilterNodeMessage(filter: unknown): string | null {
    if (!isRecord(filter)) {
        return 'Run filter must be an object.';
    }

    return invalidKnownFilterMessage(filter);
}

function childFilterLevel(filters: readonly unknown[]): readonly unknown[] {
    return filters.flatMap(function childFilters(filter) {
        return isRecord(filter) ? filterChildren(filter) : [];
    });
}

function invalidFilterLevelMessage(filters: readonly unknown[]): string | null {
    for (const filter of filters) {
        const message = invalidFilterNodeMessage(filter);

        if (message !== null) {
            return message;
        }
    }

    return null;
}

function invalidRunFilterMessage(filter: unknown): string | null {
    let pendingFilters: readonly unknown[] = [ filter ];

    while (pendingFilters.length > 0) {
        const message = invalidFilterLevelMessage(pendingFilters);

        if (message !== null) {
            return message;
        }

        pendingFilters = childFilterLevel(pendingFilters);
    }

    return null;
}

export function invalidRunSelectionMessage(selection: unknown): string | null {
    if (!isRecord(selection)) {
        return 'Run selection must be an object.';
    }

    if (selection.kind === 'all') {
        return null;
    }

    if (selection.kind === 'filter') {
        return invalidRunFilterMessage(selection.filter);
    }

    return 'Run selection kind is unknown.';
}

type LeafRunFilter = Exclude<RunFilter, { readonly kind: 'all' | 'any' | 'not'; }>;
type RuntimeRunFilter = Extract<
    LeafRunFilter,
    { readonly kind: 'runtime' | 'runtime-dimension' | 'runtime-scenario' | 'runtime-variant'; }
>;
const runtimeRunFilterKinds: ReadonlySet<string> = new Set([
    'runtime',
    'runtime-dimension',
    'runtime-scenario',
    'runtime-variant'
]);

function isRuntimeRunFilter(filter: LeafRunFilter): filter is RuntimeRunFilter {
    return runtimeRunFilterKinds.has(filter.kind);
}

function copyRuntimeRunFilter(filter: RuntimeRunFilter): RunFilter {
    if (filter.kind === 'runtime') {
        return runtime(filter.runtime);
    }

    if (filter.kind === 'runtime-variant') {
        return runtimeVariant(filter.runtime, filter.variantId);
    }

    if (filter.kind === 'runtime-dimension') {
        return runtimeDimension(filter.runtime, filter.dimension, filter.value);
    }

    return runtimeScenario(filter.runtime, filter.scenario, filter.value);
}

function copyLeafRunFilter(filter: LeafRunFilter): RunFilter {
    if (filter.kind === 'case-id') {
        return caseId(filter.id);
    }

    if (filter.kind === 'glob') {
        return glob(filter.field, filter.pattern);
    }

    if (isRuntimeRunFilter(filter)) {
        return copyRuntimeRunFilter(filter);
    }

    return {
        field: filter.field,
        kind: filter.kind,
        value: filter.value
    };
}

function copyRunFilter(filter: RunFilter): RunFilter {
    if (filter.kind === 'all' || filter.kind === 'any') {
        return {
            filters: assertNonEmptyFilters(filter.filters.map(copyRunFilter)),
            kind: filter.kind
        };
    }

    if (filter.kind === 'not') {
        return {
            filter: copyRunFilter(filter.filter),
            kind: 'not'
        };
    }

    return copyLeafRunFilter(filter);
}

export function copyRunSelection(selection: RunSelection): RunSelection {
    if (selection.kind === 'all') {
        return { kind: 'all' };
    }

    return {
        filter: copyRunFilter(selection.filter),
        kind: 'filter'
    };
}

function normalizedValue(value: string): string {
    return value.toLowerCase();
}

function suitePath(suiteParts: readonly string[]): readonly string[] {
    if (suiteParts.length === 0) {
        return [];
    }

    return [ suiteParts.join(' > ') ];
}

const candidateFieldReaders: CandidateFieldReaders = {
    file(candidate) {
        return candidate.id.file === null ? [] : [ candidate.id.file ];
    },
    owner(candidate) {
        return candidate.annotations.ownership;
    },
    params(candidate) {
        return candidate.id.params === null ? [] : [ candidate.id.params ];
    },
    suite(candidate) {
        return suitePath(candidate.id.suite);
    },
    tag(candidate) {
        return candidate.annotations.tags;
    },
    title(candidate) {
        return [ candidate.id.title ];
    }
};

function candidateFieldValues(candidate: RunFilterCandidate, field: RunStringFilterField): readonly string[] {
    return candidateFieldReaders[field](candidate);
}

function matchesStringFilter(
    candidate: RunFilterCandidate,
    field: RunStringFilterField,
    match: (value: string) => boolean
): boolean {
    return candidateFieldValues(candidate, field)
        .map(normalizedValue)
        .some(match);
}

function matchesTextFilter(filter: RunFilter, candidate: RunFilterCandidate): boolean {
    if (filter.kind === 'contains') {
        const expected = normalizedValue(filter.value);

        return matchesStringFilter(candidate, filter.field, function valueContains(value) {
            return value.includes(expected);
        });
    }

    if (filter.kind === 'equals') {
        const expected = normalizedValue(filter.value);

        return matchesStringFilter(candidate, filter.field, function valueEquals(value) {
            return value === expected;
        });
    }

    if (filter.kind === 'glob') {
        const pattern = normalizedValue(filter.pattern);

        return matchesStringFilter(candidate, filter.field, function valueMatchesGlob(value) {
            return path.matchesGlob(value, pattern);
        });
    }

    return false;
}

function matchesRuntimeRunFilter(filter: RuntimeRunFilter, candidate: RunFilterCandidate): boolean {
    return candidate.workId.runtimes.some(function runtimeMatches(candidateRuntime) {
        if (candidateRuntime.name !== filter.runtime) {
            return false;
        }

        if (filter.kind === 'runtime') {
            return true;
        }

        if (filter.kind === 'runtime-variant') {
            return candidateRuntime.variantId === filter.variantId;
        }

        if (filter.kind === 'runtime-dimension') {
            return candidateRuntime.dimensions[filter.dimension] === filter.value;
        }

        return candidateRuntime.scenarios[filter.scenario] === filter.value;
    });
}

function matchesLeafRunFilter(filter: LeafRunFilter, candidate: RunFilterCandidate): boolean {
    if (filter.kind === 'case-id') {
        return caseIdentityKey(filter.id) === caseIdentityKey(candidate.id);
    }

    if (isRuntimeRunFilter(filter)) {
        return matchesRuntimeRunFilter(filter, candidate);
    }

    return matchesTextFilter(filter, candidate);
}

export function matchesRunFilter(filter: RunFilter, candidate: RunFilterCandidate): boolean {
    if (filter.kind === 'all') {
        return filter.filters.every(function childMatches(childFilter) {
            return matchesRunFilter(childFilter, candidate);
        });
    }

    if (filter.kind === 'any') {
        return filter.filters.some(function childMatches(childFilter) {
            return matchesRunFilter(childFilter, candidate);
        });
    }

    if (filter.kind === 'not') {
        return !matchesRunFilter(filter.filter, candidate);
    }

    return matchesLeafRunFilter(filter, candidate);
}
