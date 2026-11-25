import {
    admitCompositeChild,
    assertCompositeChild,
    dataField,
    invalidAssertionProtocol,
    InvalidAssertionProtocolError,
    nonEmptyProtocolItems,
    protocolObject
} from '../assertion-protocol/assertion-validation.ts';
import { captureAssertion, transferAssertionObservation } from '../assertion-protocol/evaluation.ts';
import type {
    AssertAssertionNode,
    CompositeAssertionChildNode,
    CompositeAssertionNode,
    RequireAssertionNode
} from '../assertion-protocol/assertion-node.ts';
import {
    captureCompositeChild,
    prepareCompositeGroup,
    getAssertionReferenceRecord,
    getNarrowingAssertionReferenceRecord,
    isAssertionReference,
    isCompositeAssertionGroup,
    isNarrowingAssertionReference,
    type AssertionReferenceRecord,
    type CompositeAssertionReferenceRecord,
    type CompositeAssertionReturn,
    type NarrowingCompositeAssertionReferenceRecord
} from '../assertion-protocol/assertion-reference.ts';
import type {
    AssertionSource,
    NonEmptyReadonlyArray,
    ResolvableSourceLocations
} from '../assertion-protocol/assertion-node-shape.ts';
import { assertionProtocolFailure } from './assertion-protocol-failure.ts';
import type { TestContractFailure } from './run-result.ts';
import type { PendingRecordedAssert } from './assertion-recorder.ts';
import { isTestControlError } from './test-control-error.ts';

const expectedArgumentSlot = 1;

export type AssertAssertionSink = {
    readonly assertRecording: (operation: string) => void;
    readonly failContract: (failure: TestContractFailure) => never;
    readonly recordAssert: (assertion: AssertAssertionNode) => void;
    readonly recordPendingAssert: () => PendingRecordedAssert;
};

export type RequireAssertionSink = {
    readonly assertRecording: (operation: string) => void;
    readonly failContract: (failure: TestContractFailure) => never;
    readonly recordRequire: (assertion: RequireAssertionNode) => void;
};

type CompositeAssertionNodeInput<Source extends AssertionSource> = {
    readonly annotation: string | null;
    readonly children: NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>;
    readonly parameters: readonly unknown[];
    readonly record: AssertionReferenceRecord;
    readonly source: Source;
    readonly sourceLocations: ResolvableSourceLocations;
};

type PendingCompositeAssertionInput = {
    readonly annotation: string | null;
    readonly parameters: readonly unknown[];
    readonly pending: PendingRecordedAssert;
    readonly record: CompositeAssertionReferenceRecord;
    readonly result: Promise<CompositeAssertionReturn<'assert'>>;
    readonly sink: AssertAssertionSink;
    readonly sourceLocations: ResolvableSourceLocations;
};

type NarrowingCompositeAssertionNodeInput<Source extends AssertionSource> = {
    readonly annotation: string | null;
    readonly parameters: readonly unknown[];
    readonly record: NarrowingCompositeAssertionReferenceRecord;
    readonly source: Source;
    readonly sourceLocations: ResolvableSourceLocations;
};

type CompositeAssertionRecordingInput = {
    readonly annotation: string | null;
    readonly parameters: readonly unknown[];
    readonly record: CompositeAssertionReferenceRecord;
    readonly sink: AssertAssertionSink;
    readonly sourceLocations: ResolvableSourceLocations;
};

type AssertReferenceRecordingInput = {
    readonly annotation: string | null;
    readonly parameters: readonly unknown[];
    readonly reference: unknown;
    readonly sink: AssertAssertionSink;
    readonly sourceLocations: ResolvableSourceLocations;
};

type RequireReferenceRecordingInput = {
    readonly annotation: string | null;
    readonly parameters: readonly unknown[];
    readonly reference: unknown;
    readonly sink: RequireAssertionSink;
    readonly sourceLocations: ResolvableSourceLocations;
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
        actual: typeof actual,
        code: 'invalid-composite-result',
        expected: 'composite assertion child or group',
        kind: 'test-contract',
        summary: 'Composite assertion returned an invalid result.'
    };
}

function isPromiseLike<Source extends AssertionSource>(
    value: unknown
): value is Promise<CompositeAssertionReturn<Source>> {
    return protocolObject(value) && !Object.hasOwn(value, 'check') &&
        !isCompositeAssertionGroup(value) && typeof Reflect.get(value, 'then') === 'function';
}

function isCompositeAssertionChildNode<Source extends AssertionSource>(
    value: unknown
): value is CompositeAssertionChildNode<Source> {
    return protocolObject(value) && Object.hasOwn(value, 'check');
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

function parseGroupChildren(group: unknown): readonly [unknown, ...unknown[]] {
    if (!protocolObject(group)) {
        throw invalidAssertionProtocol('group', 'expected a protocol record');
    }
    return nonEmptyProtocolItems(dataField(group, 'children', 'group.children'), 'group.children');
}

function groupResult<Source extends AssertionSource>(
    group: unknown,
    source: Source
): NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>> {
    const [ first, ...rest ] = parseGroupChildren(group);
    assertCompositeChild(first, source, 'group.children[0]');
    return [
        first,
        ...rest.map(function validate(child, index) {
            assertCompositeChild(child, source, `group.children[${index + 1}]`);
            return child;
        })
    ];
}

function isProtocolGroup(value: unknown): boolean {
    return protocolObject(value) && isCompositeAssertionGroup(value);
}

function normalizeCompositeChildren(
    result: CompositeAssertionReturn<'assert'>,
    failContract: (failure: TestContractFailure) => never
): NonEmptyReadonlyArray<CompositeAssertionChildNode<'assert'>> {
    if (isProtocolGroup(result)) {
        try {
            return groupResult(result, 'assert');
        } catch (error) {
            if (!(error instanceof InvalidAssertionProtocolError)) {
                throw error;
            }
            const failure = error.diagnostic().path === 'group.children'
                ? createInvalidCompositeResultFailure(result)
                : assertionProtocolFailure(error);
            return failContract(failure);
        }
    }
    if (isCompositeAssertionChildNode<'assert'>(result)) {
        return [ result ];
    }
    return failContract(createInvalidCompositeResultFailure(result));
}

function flattenValidatedGroup(items: unknown): NonEmptyReadonlyArray<CompositeAssertionChildNode<'assert'>> {
    const children = nonEmptyProtocolItems(items, 'group').flatMap(function prepareItem(item, index) {
        if (isProtocolGroup(item)) {
            return groupResult(item, 'assert');
        }
        assertCompositeChild(item, 'assert', `group[${index}]`);
        return [ item ];
    });
    const [ first, ...rest ] = children;
    if (first === undefined) {
        throw invalidAssertionProtocol('group', 'expected at least one child');
    }
    return [ first, ...rest ];
}

function validatedGroup(
    items: unknown,
    sink: AssertAssertionSink
): NonEmptyReadonlyArray<CompositeAssertionChildNode<'assert'>> {
    try {
        return flattenValidatedGroup(items);
    } catch (error) {
        if (!(error instanceof InvalidAssertionProtocolError)) {
            throw error;
        }
        return sink.failContract(assertionProtocolFailure(error));
    }
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
        message: input.annotation,
        name: input.record.name,
        source: input.source,
        sourceLocations: input.sourceLocations,
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
        message: `Expected ${input.record.name} narrowing predicate to pass.`,
        source: input.source,
        sourceLocations: input.sourceLocations
    };

    return createCompositeAssertionNode({
        annotation: input.annotation,
        children: [ child ],
        parameters: input.parameters,
        record: input.record,
        source: input.source,
        sourceLocations: input.sourceLocations
    });
}

function discardRejectedComposite(input: PendingCompositeAssertionInput, error: unknown): never {
    if (isTestControlError(error)) {
        input.pending.discard();
    }
    throw error;
}

async function awaitCompositeResult(
    input: PendingCompositeAssertionInput
): Promise<CompositeAssertionReturn<'assert'>> {
    try {
        return await input.result;
    } catch (error: unknown) {
        return discardRejectedComposite(input, error);
    }
}

function resolveCompositeAssertion(
    input: PendingCompositeAssertionInput,
    resolved: CompositeAssertionReturn<'assert'>
): CompositeAssertionNode<'assert'> {
    try {
        return createCompositeAssertionNode({
            annotation: input.annotation,
            children: normalizeCompositeChildren(resolved, input.sink.failContract),
            parameters: input.parameters,
            record: input.record,
            source: 'assert',
            sourceLocations: input.sourceLocations
        });
    } catch (error: unknown) {
        return discardRejectedComposite(input, error);
    }
}

async function recordResolvedCompositeAssertion(input: PendingCompositeAssertionInput): Promise<void> {
    const resolved = await awaitCompositeResult(input);
    input.sink.assertRecording('finish an asynchronous assertion');
    const assertion = resolveCompositeAssertion(input, resolved);
    input.pending.resolve(assertion);
}

function recordCompositeAssertion(input: CompositeAssertionRecordingInput): Promise<void> | void {
    const invocation = {
        message: null,
        parameters: input.parameters,
        source: 'assert' as const,
        sourceLocations: input.sourceLocations
    };
    Object.defineProperties(invocation, {
        [captureCompositeChild]: {
            value(child: CompositeAssertionChildNode<'assert'>) {
                input.sink.assertRecording('record a composite assertion child');
                try {
                    const admitted = admitCompositeChild(child, 'assert', 'child');
                    captureAssertion(admitted);
                    transferAssertionObservation(admitted, child);
                } catch (error) {
                    if (!(error instanceof InvalidAssertionProtocolError)) {
                        throw error;
                    }
                    input.sink.failContract(assertionProtocolFailure(error));
                }
            }
        },
        [prepareCompositeGroup]: {
            value(items: unknown) {
                return validatedGroup(items, input.sink);
            }
        }
    });
    const result = input.record.run(invocation);

    if (!isPromiseLike(result)) {
        input.sink.recordAssert(createCompositeAssertionNode({
            annotation: input.annotation,
            children: normalizeCompositeChildren(result, input.sink.failContract),
            parameters: input.parameters,
            record: input.record,
            source: 'assert',
            sourceLocations: input.sourceLocations
        }));
        return undefined;
    }

    return recordResolvedCompositeAssertion({
        annotation: input.annotation,
        parameters: input.parameters,
        pending: input.sink.recordPendingAssert(),
        record: input.record,
        result,
        sink: input.sink,
        sourceLocations: input.sourceLocations
    });
}

export function recordAssertReference(input: AssertReferenceRecordingInput): Promise<void> | void {
    input.sink.assertRecording('invoke a custom assertion');
    if (!isAssertionReference(input.reference)) {
        input.sink.failContract(createInvalidAssertionReferenceFailure(input.reference));
    }

    const record = getAssertionReferenceRecord(input.reference);

    if (record.kind === 'narrowing-composite') {
        input.sink.recordAssert(createNarrowingCompositeAssertionNode({
            annotation: input.annotation,
            parameters: input.parameters,
            record,
            source: 'assert',
            sourceLocations: input.sourceLocations
        }));
        return undefined;
    }

    return recordCompositeAssertion({
        annotation: input.annotation,
        parameters: input.parameters,
        record,
        sink: input.sink,
        sourceLocations: input.sourceLocations
    });
}

export function recordRequireReference(input: RequireReferenceRecordingInput): void {
    input.sink.assertRecording('invoke a custom requirement');
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
        parameters: input.parameters,
        record,
        source: 'require',
        sourceLocations: input.sourceLocations
    }));
}
