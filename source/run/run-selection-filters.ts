import { posix as path } from 'node:path';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import type { Stability } from '../engine/metadata.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { RunFilter, RunSelection, RunStringFilterField } from './run-types.ts';

type RunFilterCandidate = {
    readonly id: CaseId;
    readonly metadata: TestPlanCase['metadata'];
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
    'runtime',
    'stability',
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

export function runtime(value: string): RunFilter {
    return equals('runtime', value);
}

export function stability(value: Stability): RunFilter {
    return equals('stability', value);
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

    if (filter.kind === 'case-id') {
        return caseId(filter.id);
    }

    if (filter.kind === 'glob') {
        return glob(filter.field, filter.pattern);
    }

    return {
        field: filter.field,
        kind: filter.kind,
        value: filter.value
    };
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
        return candidate.metadata.ownership;
    },
    params(candidate) {
        return candidate.id.params === null ? [] : [ candidate.id.params ];
    },
    runtime(candidate) {
        return candidate.metadata.runtimes;
    },
    stability(candidate) {
        return [ candidate.metadata.stability ];
    },
    suite(candidate) {
        return suitePath(candidate.id.suite);
    },
    tag(candidate) {
        return candidate.metadata.tags;
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

    if (filter.kind === 'case-id') {
        return caseIdentityKey(filter.id) === caseIdentityKey(candidate.id);
    }

    return matchesTextFilter(filter, candidate);
}
