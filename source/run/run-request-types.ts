import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { Engine } from '../engine/engine.ts';
import type { CaseId } from '../engine/identity.ts';

export type RunEngineSelection = {
    readonly engine: Engine;
    readonly kind: 'instance';
} | {
    readonly exportKind: 'getter' | 'value';
    readonly exportName: string;
    readonly kind: 'module';
    readonly moduleUrl: string;
} | {
    readonly kind: 'default';
};

export type RunStringFilterField = keyof {
    readonly file: true;
    readonly owner: true;
    readonly params: true;
    readonly suite: true;
    readonly tag: true;
    readonly title: true;
};

export type RunRuntimeScenarioFilter = {
    readonly kind: 'runtime-scenario';
    readonly runtime: string;
    readonly scenario: string;
    readonly value: string;
};

export type RunRuntimeFilter = {
    readonly kind: 'runtime';
    readonly runtime: string;
};

export type RunRuntimeVariantFilter = {
    readonly kind: 'runtime-variant';
    readonly runtime: string;
    readonly variantId: string;
};

export type RunRuntimeDimensionFilter = {
    readonly dimension: string;
    readonly kind: 'runtime-dimension';
    readonly runtime: string;
    readonly value: string;
};

type RunFilterByKind = {
    readonly all: {
        readonly filters: NonEmptyReadonlyArray<RunFilter>;
        readonly kind: 'all';
    };
    readonly any: {
        readonly filters: NonEmptyReadonlyArray<RunFilter>;
        readonly kind: 'any';
    };
    readonly 'case-id': {
        readonly id: CaseId;
        readonly kind: 'case-id';
    };
    readonly contains: {
        readonly field: RunStringFilterField;
        readonly kind: 'contains';
        readonly value: string;
    };
    readonly equals: {
        readonly field: RunStringFilterField;
        readonly kind: 'equals';
        readonly value: string;
    };
    readonly glob: {
        readonly field: RunStringFilterField;
        readonly kind: 'glob';
        readonly pattern: string;
    };
    readonly not: {
        readonly filter: RunFilter;
        readonly kind: 'not';
    };
    readonly runtime: RunRuntimeFilter;
    readonly 'runtime-dimension': RunRuntimeDimensionFilter;
    readonly 'runtime-scenario': RunRuntimeScenarioFilter;
    readonly 'runtime-variant': RunRuntimeVariantFilter;
};

export type RunFilter = RunFilterByKind[keyof RunFilterByKind];

export type RunSelection = {
    readonly filter: RunFilter;
    readonly kind: 'filter';
} | {
    readonly kind: 'all';
};
