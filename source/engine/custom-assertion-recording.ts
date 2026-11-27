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
    recordCompositeDiagnostics,
    type CompositeDiagnosticRecording,
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
import { observeAssertionBody, type AssertionRecordingContext } from './assertion-lifetime.ts';
import { foreignAssertionDiagnostic, foreignDiagnostic, ownAssertionDiagnostic } from './assertion-ownership.ts';
import { assertionProtocolFailure } from './assertion-protocol-failure.ts';
import type { TestContractFailure } from './run-result.ts';
import type { PendingRecordedAssert } from './assertion-recorder.ts';
import { isTestControlError } from './test-control-error.ts';

const expectedArgumentSlot = 1;

export type AssertAssertionSink = {
    readonly child: () => AssertionRecordingContext;
    readonly assertRecording: (operation: string) => void;
    readonly failContract: (failure: TestContractFailure) => never;
    readonly recordAssert: (assertion: AssertAssertionNode) => void;
    readonly recordPendingAssert: () => PendingRecordedAssert;
};

export type RequireAssertionSink = {
    readonly child: () => AssertionRecordingContext;
    readonly assertRecording: (operation: string) => void;
    readonly failContract: (failure: TestContractFailure) => never;
    readonly recordRequire: (assertion: RequireAssertionNode) => void;
};

type CompositeAssertionNodeInput<Source extends AssertionSource> = {
    readonly sink: Pick<AssertAssertionSink, 'child'>;
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
    readonly resolveChildren: (
        result: CompositeAssertionReturn<'assert'>
    ) => NonEmptyReadonlyArray<CompositeAssertionChildNode<'assert'>>;
    readonly result: Promise<CompositeAssertionReturn<'assert'>>;
    readonly sink: AssertAssertionSink;
    readonly sourceLocations: ResolvableSourceLocations;
};

type NarrowingCompositeAssertionNodeInput<Source extends AssertionSource> = {
    readonly sink: Pick<AssertAssertionSink, 'child'>;
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

function flattenValidatedGroup(
    items: unknown,
    assertOwner: (item: unknown) => void
): NonEmptyReadonlyArray<CompositeAssertionChildNode<'assert'>> {
    const children = nonEmptyProtocolItems(items, 'group').flatMap(function prepareItem(item, index) {
        assertOwner(item);
        if (isProtocolGroup(item)) {
            const group = groupResult(item, 'assert');
            group.forEach(assertOwner);
            return group;
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

function runCustomCallback<Result>(context: AssertionRecordingContext, callback: () => Result): Result {
    return context.run(() => observeAssertionBody(callback, () => context.close('settled')));
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
        summary: input.record.formatSummary === null || input.annotation !== null
            ? customSummary(input.record, input.source, input.annotation, input.parameters)
            : runCustomCallback(input.sink.child(), function formatCustomSummary() {
                return customSummary(input.record, input.source, input.annotation, input.parameters);
            })
    };
}

function createNarrowingCompositeAssertionNode<Source extends AssertionSource>(
    input: NarrowingCompositeAssertionNodeInput<Source>
): CompositeAssertionNode<Source> {
    const passed = runCustomCallback(input.sink.child(), function evaluateNarrowingPredicate() {
        return input.record.narrows(input.parameters[0], ...input.parameters.slice(1));
    });
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
        sink: input.sink,
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
            children: input.resolveChildren(resolved),
            sink: input.sink,
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
    const context = input.sink.child();
    let pendingChildren = 0;
    let unfinishedChildren = 0;

    function requireDiagnosticOwner(diagnostic: unknown): void {
        if (foreignDiagnostic(diagnostic, context)) {
            context.fail(foreignAssertionDiagnostic(context.origin));
        }
    }

    function resolveChildren(result: CompositeAssertionReturn<'assert'>) {
        if (unfinishedChildren > 0) {
            input.sink.failContract({
                actual: unfinishedChildren,
                code: 'pending-async-assertion',
                expected: 'all asynchronous diagnostic checks to settle before the custom assertion completes',
                kind: 'test-contract',
                summary: 'The custom assertion completed with pending asynchronous diagnostics.'
            });
        }
        requireDiagnosticOwner(result);
        const children = normalizeCompositeChildren(result, input.sink.failContract);
        children.forEach(requireDiagnosticOwner);
        return children;
    }

    const recording: CompositeDiagnosticRecording = {
        assertRecording: context.assertRecording,
        beginAsync() {
            context.assertRecording('start an asynchronous assertion diagnostic');
            pendingChildren += 1;
            return function finishDiagnostic() {
                pendingChildren -= 1;
            };
        },
        group(group) {
            context.assertRecording('record an assertion diagnostic group');
            ownAssertionDiagnostic(group, context);
        }
    };
    const invocation = {
        [recordCompositeDiagnostics]: recording,
        message: null,
        parameters: input.parameters,
        source: 'assert' as const,
        sourceLocations: input.sourceLocations
    };
    Object.defineProperties(invocation, {
        [captureCompositeChild]: {
            value(child: CompositeAssertionChildNode<'assert'>) {
                context.assertRecording('record a composite assertion child');
                try {
                    const admitted = admitCompositeChild(child, 'assert', 'child');
                    captureAssertion(admitted);
                    transferAssertionObservation(admitted, child);
                    ownAssertionDiagnostic(child, context);
                } catch (error) {
                    if (!(error instanceof InvalidAssertionProtocolError)) {
                        throw error;
                    }
                    context.fail(assertionProtocolFailure(error));
                }
            }
        },
        [prepareCompositeGroup]: {
            value(items: unknown) {
                context.assertRecording('group assertion diagnostics');
                try {
                    return flattenValidatedGroup(items, requireDiagnosticOwner);
                } catch (error) {
                    if (!(error instanceof InvalidAssertionProtocolError)) {
                        throw error;
                    }
                    return context.fail(assertionProtocolFailure(error));
                }
            }
        }
    });
    const result = context.run(() => observeAssertionBody(
        function invokeCustomAssertion() {
            const outcome = input.record.run(invocation);
            return isPromiseLike(outcome) ? Promise.resolve(outcome) : outcome;
        },
        function closeDiagnosticRecording() {
            unfinishedChildren = Math.max(unfinishedChildren, pendingChildren);
            context.close('settled');
        }
    ));

    if (!isPromiseLike(result)) {
        input.sink.recordAssert(createCompositeAssertionNode({
            annotation: input.annotation,
            children: resolveChildren(result),
            sink: input.sink,
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
        resolveChildren,
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
            sink: input.sink,
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
        sink: input.sink,
        source: 'require',
        sourceLocations: input.sourceLocations
    }));
}
