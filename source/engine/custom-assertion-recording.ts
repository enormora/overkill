import type {
    AssertAssertionNode,
    CompositeAssertionChildNode,
    CompositeAssertionNode,
    RequireAssertionNode
} from '../assertion-protocol/assertion-node.ts';
import {
    getAssertionReferenceRecord,
    getNarrowingAssertionReferenceRecord,
    isAssertionReference,
    isCompositeAssertionGroup,
    isNarrowingAssertionReference,
    type AssertionReferenceRecord,
    type CompositeAssertionReferenceRecord,
    type CompositeAssertionReturn,
    type NarrowingCompositeAssertionReferenceRecord
} from '../packages/engine/assertion-protocol.entry-point.ts';
import type {
    AssertionSource,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import type { TestContractFailure } from './run-result.ts';

const expectedArgumentSlot = 1;

type PendingAssertAssertionSink = {
    readonly resolve: (assertion: AssertAssertionNode) => void;
};

export type AssertAssertionSink = {
    readonly failContract: (failure: TestContractFailure) => never;
    readonly recordAssert: (assertion: AssertAssertionNode) => void;
    readonly recordPendingAssert: () => PendingAssertAssertionSink;
};

export type RequireAssertionSink = {
    readonly failContract: (failure: TestContractFailure) => never;
    readonly recordRequire: (assertion: RequireAssertionNode) => void;
};

type CompositeAssertionNodeInput<Source extends AssertionSource> = {
    readonly annotation: string | null;
    readonly children: NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly record: AssertionReferenceRecord;
    readonly source: Source;
};

type PendingCompositeAssertionInput = {
    readonly annotation: string | null;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly pending: PendingAssertAssertionSink;
    readonly record: CompositeAssertionReferenceRecord;
    readonly result: Promise<CompositeAssertionReturn<'assert'>>;
    readonly sink: AssertAssertionSink;
};

type NarrowingCompositeAssertionNodeInput<Source extends AssertionSource> = {
    readonly annotation: string | null;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly record: NarrowingCompositeAssertionReferenceRecord;
    readonly source: Source;
};

type CompositeAssertionRecordingInput = {
    readonly annotation: string | null;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly record: CompositeAssertionReferenceRecord;
    readonly sink: AssertAssertionSink;
};

type AssertReferenceRecordingInput = {
    readonly annotation: string | null;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly reference: unknown;
    readonly sink: AssertAssertionSink;
};

type RequireReferenceRecordingInput = {
    readonly annotation: string | null;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly reference: unknown;
    readonly sink: RequireAssertionSink;
};

function createInvalidAssertionReferenceFailure(actual: unknown): TestContractFailure {
    return {
        actual,
        code: 'invalid-assertion-reference',
        expected: 'engine-created assertion reference',
        kind: 'test-contract',
        summary: 'Expected an engine-created assertion reference.'
    };
}

function createInvalidRequireReferenceFailure(actual: unknown): TestContractFailure {
    return {
        actual,
        code: 'invalid-require-reference',
        expected: 'narrowing assertion reference',
        kind: 'test-contract',
        summary: 'Expected a narrowing assertion reference.'
    };
}

function createInvalidCompositeResultFailure(actual: unknown): TestContractFailure {
    return {
        actual,
        code: 'invalid-composite-result',
        expected: 'composite assertion child or group',
        kind: 'test-contract',
        summary: 'Composite assertion returned an invalid result.'
    };
}

function isPromiseLike<Source extends AssertionSource>(
    value: unknown
): value is Promise<CompositeAssertionReturn<Source>> {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'then') === 'function';
}

function isCompositeAssertionChildNode<Source extends AssertionSource>(
    value: unknown
): value is CompositeAssertionChildNode<Source> {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, 'check');
}

function assertionArguments(parameters: readonly unknown[]): readonly [unknown, unknown] {
    return [
        parameters[0],
        parameters.at(expectedArgumentSlot)
    ];
}

function defaultCustomSummary(name: string): string {
    return `Expected ${name} assertion to pass.`;
}

function customSummary(
    record: AssertionReferenceRecord,
    source: AssertionSource,
    annotation: string | null,
    parameters: readonly unknown[]
): string {
    if (annotation !== null) {
        return annotation;
    }

    if (record.formatSummary !== null) {
        if (record.kind === 'composite') {
            return record.formatSummary({ name: record.name, source }, ...parameters);
        }

        return record.formatSummary({ name: record.name, source }, parameters[0], ...parameters.slice(1));
    }

    return defaultCustomSummary(record.name);
}

function normalizeCompositeChildren<Source extends AssertionSource>(
    result: CompositeAssertionReturn<Source>,
    failContract: (failure: TestContractFailure) => never
): NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>> {
    if (isCompositeAssertionGroup<Source>(result)) {
        return result.children;
    }

    if (isCompositeAssertionChildNode<Source>(result)) {
        return [ result ];
    }

    return failContract(createInvalidCompositeResultFailure(result));
}

function createCompositeAssertionNode<Source extends AssertionSource>(
    input: CompositeAssertionNodeInput<Source>
): CompositeAssertionNode<Source> {
    const [ actual, expectedArgument ] = assertionArguments(input.parameters);

    return {
        actual,
        check: 'composite',
        children: input.children,
        expected: expectedArgument ?? input.record.name,
        location: input.location,
        message: input.annotation,
        name: input.record.name,
        source: input.source,
        summary: customSummary(input.record, input.source, input.annotation, input.parameters)
    };
}

function createNarrowingCompositeAssertionNode<Source extends AssertionSource>(
    input: NarrowingCompositeAssertionNodeInput<Source>
): CompositeAssertionNode<Source> {
    const passed = input.record.narrows(input.parameters[0], ...input.parameters.slice(1));
    const child: CompositeAssertionChildNode<Source> = {
        actual: passed,
        check: 'true',
        location: input.location,
        message: `Expected ${input.record.name} narrowing predicate to pass.`,
        source: input.source
    };

    return createCompositeAssertionNode({
        annotation: input.annotation,
        children: [ child ],
        location: input.location,
        parameters: input.parameters,
        record: input.record,
        source: input.source
    });
}

async function recordResolvedCompositeAssertion(input: PendingCompositeAssertionInput): Promise<void> {
    const resolved = await input.result;

    input.pending.resolve(createCompositeAssertionNode({
        annotation: input.annotation,
        children: normalizeCompositeChildren(resolved, input.sink.failContract),
        location: input.location,
        parameters: input.parameters,
        record: input.record,
        source: 'assert'
    }));
}

function recordCompositeAssertion(input: CompositeAssertionRecordingInput): Promise<void> | void {
    const result = input.record.run({
        location: input.location,
        message: null,
        parameters: input.parameters,
        source: 'assert'
    });

    if (!isPromiseLike(result)) {
        input.sink.recordAssert(createCompositeAssertionNode({
            annotation: input.annotation,
            children: normalizeCompositeChildren(result, input.sink.failContract),
            location: input.location,
            parameters: input.parameters,
            record: input.record,
            source: 'assert'
        }));
        return undefined;
    }

    return recordResolvedCompositeAssertion({
        annotation: input.annotation,
        location: input.location,
        parameters: input.parameters,
        pending: input.sink.recordPendingAssert(),
        record: input.record,
        result,
        sink: input.sink
    });
}

export function recordAssertReference(input: AssertReferenceRecordingInput): Promise<void> | void {
    if (!isAssertionReference(input.reference)) {
        input.sink.failContract(createInvalidAssertionReferenceFailure(input.reference));
    }

    const record = getAssertionReferenceRecord(input.reference);

    if (record.kind === 'narrowing-composite') {
        input.sink.recordAssert(createNarrowingCompositeAssertionNode({
            annotation: input.annotation,
            location: input.location,
            parameters: input.parameters,
            record,
            source: 'assert'
        }));
        return undefined;
    }

    return recordCompositeAssertion({
        annotation: input.annotation,
        location: input.location,
        parameters: input.parameters,
        record,
        sink: input.sink
    });
}

export function recordRequireReference(input: RequireReferenceRecordingInput): void {
    if (!isNarrowingAssertionReference(input.reference)) {
        input.sink.failContract(
            isAssertionReference(input.reference)
                ? createInvalidRequireReferenceFailure(getAssertionReferenceRecord(input.reference).name)
                : createInvalidAssertionReferenceFailure(input.reference)
        );
    }

    const record = getNarrowingAssertionReferenceRecord(input.reference);

    input.sink.recordRequire(createNarrowingCompositeAssertionNode({
        annotation: input.annotation,
        location: input.location,
        parameters: input.parameters,
        record,
        source: 'require'
    }));
}
