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
import type { AssertionSource, NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
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
    readonly parameters: readonly unknown[];
    readonly reference: AssertionReference;
    readonly source: Source;
};

type PendingCompositeAssertionInput = {
    readonly annotation: string | null;
    readonly parameters: readonly unknown[];
    readonly pending: PendingAssertAssertionSink;
    readonly reference: CompositeAssertionReference;
    readonly result: Promise<CompositeAssertionReturn<'assert'>>;
    readonly sink: AssertAssertionSink;
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
        message: input.annotation,
        name: input.reference.name,
        source: input.source,
        summary: customSummary(input.reference, input.source, input.annotation, input.parameters)
    };
}

function createNarrowingCompositeAssertionNode<Source extends AssertionSource>(
    source: Source,
    annotation: string | null,
    reference: NarrowingCompositeAssertionReference,
    parameters: readonly unknown[]
): CompositeAssertionNode<Source> {
    const passed = reference.narrows(parameters[0], ...parameters.slice(1));
    const child = createCompositeCheckBuilder(source, `Expected ${reference.name} narrowing predicate to pass.`)
        .true(passed);

    return createCompositeAssertionNode({
        annotation,
        children: [ child ],
        parameters,
        reference,
        source
    });
}

async function recordResolvedCompositeAssertion(input: PendingCompositeAssertionInput): Promise<void> {
    const resolved = await input.result;

    input.pending.resolve(createCompositeAssertionNode({
        annotation: input.annotation,
        children: normalizeCompositeChildren(resolved, input.sink.failContract),
        parameters: input.parameters,
        reference: input.reference,
        source: 'assert'
    }));
}

function recordCompositeAssertion(
    sink: AssertAssertionSink,
    annotation: string | null,
    reference: CompositeAssertionReference,
    parameters: readonly unknown[]
): Promise<void> | void {
    const result = reference.assert(createCompositeCheckBuilder('assert', null), ...parameters);

    if (!isPromiseLike(result)) {
        sink.recordAssert(createCompositeAssertionNode({
            annotation,
            children: normalizeCompositeChildren(result, sink.failContract),
            parameters,
            reference,
            source: 'assert'
        }));
        return undefined;
    }

    return recordResolvedCompositeAssertion({
        annotation,
        parameters,
        pending: sink.recordPendingAssert(),
        reference,
        result,
        sink
    });
}

export function recordAssertReference(
    sink: AssertAssertionSink,
    annotation: string | null,
    reference: unknown,
    parameters: readonly unknown[]
): Promise<void> | void {
    if (!isAssertionReference(reference)) {
        sink.failContract(createInvalidAssertionReferenceFailure(reference));
    }

    if (reference.kind === 'narrowing-composite') {
        sink.recordAssert(createNarrowingCompositeAssertionNode('assert', annotation, reference, parameters));
        return undefined;
    }

    return recordCompositeAssertion(sink, annotation, reference, parameters);
}

export function recordRequireReference(
    sink: RequireAssertionSink,
    annotation: string | null,
    reference: unknown,
    parameters: readonly unknown[]
): void {
    if (!isNarrowingAssertionReference(reference)) {
        sink.failContract(
            isAssertionReference(reference)
                ? createInvalidRequireReferenceFailure(reference.name)
                : createInvalidAssertionReferenceFailure(reference)
        );
    }

    sink.recordRequire(createNarrowingCompositeAssertionNode('require', annotation, reference, parameters));
}
