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
    CompositeAssertionChildNode
} from '../assertion-protocol/assertion-node.ts';
import {
    captureCompositeChild,
    recordCompositeDiagnostics,
    type CompositeDiagnosticRecording,
    prepareCompositeGroup,
    isCompositeAssertionGroup,
    type CompositeAssertionReferenceRecord,
    type CompositeAssertionReturn,
    type AssertCompositeAssertionReturn
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

type CompositeDiagnosticInput = {
    readonly parameters: readonly unknown[];
    readonly record: CompositeAssertionReferenceRecord;
    readonly sourceLocations: ResolvableSourceLocations;
};

type CompositeDiagnostics = {
    readonly result: AssertCompositeAssertionReturn;
    readonly resolveChildren: (
        result: CompositeAssertionReturn<'assert'>
    ) => NonEmptyReadonlyArray<CompositeAssertionChildNode<'assert'>>;
};

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

export function recordCompositeDiagnosticsFor(
    input: CompositeDiagnosticInput,
    context: AssertionRecordingContext
): CompositeDiagnostics {
    const asyncChildren = { pending: 0, unfinished: 0 };

    function requireDiagnosticOwner(diagnostic: unknown): void {
        if (foreignDiagnostic(diagnostic, context)) {
            context.fail(foreignAssertionDiagnostic(context.origin));
        }
    }

    function resolveChildren(
        result: CompositeAssertionReturn<'assert'>
    ): NonEmptyReadonlyArray<CompositeAssertionChildNode<'assert'>> {
        if (asyncChildren.unfinished > 0) {
            context.fail({
                actual: asyncChildren.unfinished,
                code: 'pending-async-assertion',
                expected: 'all asynchronous diagnostic checks to settle before the custom assertion completes',
                kind: 'test-contract',
                summary: 'The custom assertion completed with pending asynchronous diagnostics.'
            });
        }
        requireDiagnosticOwner(result);
        const children = normalizeCompositeChildren(result, context.fail);
        children.forEach(requireDiagnosticOwner);
        return children;
    }

    const recording: CompositeDiagnosticRecording = {
        assertRecording: context.assertRecording,
        beginAsync() {
            context.assertRecording('start an asynchronous assertion diagnostic');
            asyncChildren.pending += 1;
            return function finishDiagnostic() {
                asyncChildren.pending -= 1;
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
    function invokeCustomAssertion(): AssertCompositeAssertionReturn {
        const outcome = input.record.run(invocation);
        return isPromiseLike(outcome) ? Promise.resolve(outcome) : outcome;
    }

    function closeDiagnosticRecording(): void {
        asyncChildren.unfinished = Math.max(asyncChildren.unfinished, asyncChildren.pending);
        context.close('settled');
    }

    const result = context.run(function executeCompositeBody(): AssertCompositeAssertionReturn {
        return observeAssertionBody(invokeCustomAssertion, closeDiagnosticRecording);
    });
    return { result, resolveChildren };
}
