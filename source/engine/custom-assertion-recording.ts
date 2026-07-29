import type {
    AssertAssertionNode,
    CompositeAssertionChildNode,
    CompositeAssertionNode,
    RequireAssertionNode
} from '../assertion-protocol/assertion-node.ts';
import {
    createCompositeCheckBuilder,
    isAssertionReference,
    isCompositeAssertionGroup,
    isNarrowingAssertionReference,
    type AssertionReference,
    type CompositeAssertionReference,
    type CompositeAssertionReturn,
    type NarrowingCompositeAssertionReference
} from '../assertion-protocol/assertion-reference.ts';
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
    readonly reference: AssertionReference;
    readonly source: Source;
};

type PendingCompositeAssertionInput = {
    readonly annotation: string | null;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly pending: PendingAssertAssertionSink;
    readonly reference: CompositeAssertionReference;
    readonly result: Promise<CompositeAssertionReturn<'assert'>>;
    readonly sink: AssertAssertionSink;
};

type NarrowingCompositeAssertionNodeInput<Source extends AssertionSource> = {
    readonly annotation: string | null;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly reference: NarrowingCompositeAssertionReference;
    readonly source: Source;
};

type CompositeAssertionRecordingInput = {
    readonly annotation: string | null;
    readonly location: ResolvableSourceLocation;
    readonly parameters: readonly unknown[];
    readonly reference: CompositeAssertionReference;
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
    reference: AssertionReference,
    source: AssertionSource,
    annotation: string | null,
    parameters: readonly unknown[]
): string {
    if (annotation !== null) {
        return annotation;
    }

    if (reference.formatSummary !== null) {
        if (reference.kind === 'composite') {
            return reference.formatSummary({ name: reference.name, source }, ...parameters);
        }

        return reference.formatSummary({ name: reference.name, source }, parameters[0], ...parameters.slice(1));
    }

    return defaultCustomSummary(reference.name);
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
        expected: expectedArgument ?? input.reference.name,
        location: input.location,
        message: input.annotation,
        name: input.reference.name,
        source: input.source,
        summary: customSummary(input.reference, input.source, input.annotation, input.parameters)
    };
}

function createNarrowingCompositeAssertionNode<Source extends AssertionSource>(
    input: NarrowingCompositeAssertionNodeInput<Source>
): CompositeAssertionNode<Source> {
    const passed = input.reference.narrows(input.parameters[0], ...input.parameters.slice(1));
    const child = createCompositeCheckBuilder(
        input.source,
        `Expected ${input.reference.name} narrowing predicate to pass.`,
        input.location
    )
        .true(passed);

    return createCompositeAssertionNode({
        annotation: input.annotation,
        children: [ child ],
        location: input.location,
        parameters: input.parameters,
        reference: input.reference,
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
        reference: input.reference,
        source: 'assert'
    }));
}

function recordCompositeAssertion(input: CompositeAssertionRecordingInput): Promise<void> | void {
    const result = input.reference.assert(
        createCompositeCheckBuilder('assert', null, input.location),
        ...input.parameters
    );

    if (!isPromiseLike(result)) {
        input.sink.recordAssert(createCompositeAssertionNode({
            annotation: input.annotation,
            children: normalizeCompositeChildren(result, input.sink.failContract),
            location: input.location,
            parameters: input.parameters,
            reference: input.reference,
            source: 'assert'
        }));
        return undefined;
    }

    return recordResolvedCompositeAssertion({
        annotation: input.annotation,
        location: input.location,
        parameters: input.parameters,
        pending: input.sink.recordPendingAssert(),
        reference: input.reference,
        result,
        sink: input.sink
    });
}

export function recordAssertReference(input: AssertReferenceRecordingInput): Promise<void> | void {
    if (!isAssertionReference(input.reference)) {
        input.sink.failContract(createInvalidAssertionReferenceFailure(input.reference));
    }

    if (input.reference.kind === 'narrowing-composite') {
        input.sink.recordAssert(createNarrowingCompositeAssertionNode({
            annotation: input.annotation,
            location: input.location,
            parameters: input.parameters,
            reference: input.reference,
            source: 'assert'
        }));
        return undefined;
    }

    return recordCompositeAssertion({
        annotation: input.annotation,
        location: input.location,
        parameters: input.parameters,
        reference: input.reference,
        sink: input.sink
    });
}

export function recordRequireReference(input: RequireReferenceRecordingInput): void {
    if (!isNarrowingAssertionReference(input.reference)) {
        input.sink.failContract(
            isAssertionReference(input.reference)
                ? createInvalidRequireReferenceFailure(input.reference.name)
                : createInvalidAssertionReferenceFailure(input.reference)
        );
    }

    input.sink.recordRequire(createNarrowingCompositeAssertionNode({
        annotation: input.annotation,
        location: input.location,
        parameters: input.parameters,
        reference: input.reference,
        source: 'require'
    }));
}
