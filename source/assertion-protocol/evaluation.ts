import { types } from 'node:util';
import type { Except } from 'type-fest';
import { isTestControlError } from '../engine/test-control-error.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import type { AssertionOutcome } from './assertion-evaluation.ts';
import {
    assertionSummary,
    type AssertAssertionNode,
    type AssertionNode,
    type BuiltInAssertAssertionNode,
    type CompositeAssertionChildNode,
    type CompositeAssertionNode,
    type ForeignAssertionNode
} from './assertion-node.ts';
import type {
    AssertionSource,
    FailedCheck,
    NonEmptyReadonlyArray,
    ResolvableSourceLocations,
    FailedForeignCheck,
    FailedLeafCheck,
    FailedCompositeCheck
} from './assertion-node-shape.ts';
import { assertionEvaluatorByCheck, type AssertionNodeByCheck } from './assertions/dispatch.ts';
import { resolveAssertionLocations, type ProtocolRecord } from './assertion-validation.ts';

type DeepAssertionCheckByName = {
    readonly arrayContainsPartial: 'array-contains-partial';
    readonly deepEqual: 'deep-equal';
    readonly membersPartialDeepEqual: 'members-partial-deep-equal';
    readonly notDeepEqual: 'not-deep-equal';
    readonly partialDeepEqual: 'partial-deep-equal';
};

type DeepAssertionCheck = DeepAssertionCheckByName[keyof DeepAssertionCheckByName];

type DeepAssertionOperandRole = 'actual' | 'expected';

type PrimitiveValueTypeByName = {
    readonly bigint: 'bigint';
    readonly boolean: 'boolean';
    readonly null: 'null';
    readonly number: 'number';
    readonly string: 'string';
    readonly symbol: 'symbol';
    readonly undefined: 'undefined';
};

type PrimitiveValueType = PrimitiveValueTypeByName[keyof PrimitiveValueTypeByName];

export type InvalidDeepAssertionOperand = {
    readonly check: DeepAssertionCheck;
    readonly index: number | null;
    readonly role: DeepAssertionOperandRole;
    readonly type: PrimitiveValueType;
};

type AssertionEvaluation = AssertionOutcome & {
    readonly summary: string;
};

type DeepAssertionNode = Extract<AssertionNode | CompositeAssertionChildNode, { readonly check: DeepAssertionCheck; }>;

type DeepOperandFinder = (
    check: DeepAssertionCheck,
    assertion: DeepAssertionNode
) => InvalidDeepAssertionOperand | null;

function primitiveValueType(value: unknown): PrimitiveValueType | null {
    if (value === null) {
        return 'null';
    }

    const valueType = typeof value;

    return valueType === 'object' || valueType === 'function' ? null : valueType;
}

function invalidOperand(
    check: DeepAssertionCheck,
    role: DeepAssertionOperandRole,
    value: unknown,
    index: number | null
): InvalidDeepAssertionOperand | null {
    const type = primitiveValueType(value);

    return type === null
        ? null
        : {
            check,
            index,
            role,
            type
        };
}

function invalidMember(
    check: DeepAssertionCheck,
    role: DeepAssertionOperandRole,
    values: readonly unknown[]
): InvalidDeepAssertionOperand | null {
    for (const [ index, value ] of values.entries()) {
        const invalid = invalidOperand(check, role, value, index);

        if (invalid !== null) {
            return invalid;
        }
    }

    return null;
}

function invalidExactDeepAssertionOperand(
    check: DeepAssertionCheck,
    assertion: DeepAssertionNode
): InvalidDeepAssertionOperand | null {
    return invalidOperand(check, 'actual', assertion.actual, null) ??
        invalidOperand(check, 'expected', assertion.expected, null);
}

function invalidArrayContainsPartialOperand(
    check: DeepAssertionCheck,
    assertion: DeepAssertionNode
): InvalidDeepAssertionOperand | null {
    const invalidActualMember = Array.isArray(assertion.actual)
        ? invalidMember(check, 'actual', assertion.actual)
        : null;

    return invalidOperand(check, 'actual', assertion.actual, null) ??
        invalidActualMember ??
        invalidOperand(check, 'expected', assertion.expected, null);
}

function invalidMembersPartialDeepEqualOperand(
    check: DeepAssertionCheck,
    assertion: DeepAssertionNode
): InvalidDeepAssertionOperand | null {
    const invalidActualMember = Array.isArray(assertion.actual)
        ? invalidMember(check, 'actual', assertion.actual)
        : null;
    const invalidExpectedMember = Array.isArray(assertion.expected)
        ? invalidMember(check, 'expected', assertion.expected)
        : null;

    return invalidOperand(check, 'actual', assertion.actual, null) ??
        invalidOperand(check, 'expected', assertion.expected, null) ??
        invalidActualMember ??
        invalidExpectedMember;
}

const deepOperandFinders: Readonly<Record<DeepAssertionCheck, DeepOperandFinder>> = {
    'array-contains-partial': invalidArrayContainsPartialOperand,
    'deep-equal': invalidExactDeepAssertionOperand,
    'members-partial-deep-equal': invalidMembersPartialDeepEqualOperand,
    'not-deep-equal': invalidExactDeepAssertionOperand,
    'partial-deep-equal': invalidExactDeepAssertionOperand
};

function isDeepAssertionCheck(check: string): check is DeepAssertionCheck {
    return Object.hasOwn(deepOperandFinders, check);
}

function isDeepAssertion(
    assertion: AssertionNode | CompositeAssertionChildNode
): assertion is DeepAssertionNode {
    return isDeepAssertionCheck(assertion.check) && Object.hasOwn(assertion, 'expected');
}

function invalidLeafOperand(assertion: EvaluatedNode): InvalidDeepAssertionOperand | null {
    return isDeepAssertion(assertion)
        ? deepOperandFinders[assertion.check](assertion.check, assertion)
        : null;
}

function evaluateAssertionNode<Check extends keyof AssertionNodeByCheck>(
    check: Check,
    assertion: AssertionNodeByCheck[Check]
): AssertionOutcome {
    return assertionEvaluatorByCheck[check](assertion);
}

function assertNonEmptyItems<Item>(
    items: readonly Item[],
    message: string
): asserts items is NonEmptyReadonlyArray<Item> {
    if (items.length === 0) {
        throw new TypeError(message);
    }
}

type Evidence<Check extends Pick<FailedCheck, 'sourceLocations'>> = Except<Check, 'sourceLocations'> & {
    readonly sourceLocations: ResolvableSourceLocations;
};

type CompositeFailureEvidence = Evidence<Except<FailedCompositeCheck, 'children'>> & {
    readonly children: NonEmptyReadonlyArray<FailureEvidence>;
};

type FailureEvidence = CompositeFailureEvidence | Evidence<FailedForeignCheck> | Evidence<FailedLeafCheck>;

type EvaluatedNode = AssertionNode | CompositeAssertionChildNode;

type AssertionObservationByKind = {
    readonly evaluated: { readonly kind: 'evaluated'; readonly failure: FailureEvidence | null; };
    readonly exception: { readonly kind: 'exception'; readonly error: unknown; };
    readonly invalid: { readonly kind: 'invalid'; readonly operand: InvalidDeepAssertionOperand; };
};

type Observation = AssertionObservationByKind[keyof AssertionObservationByKind];

type AssertionObservations = WeakMap<ProtocolRecord, Observation>;

const observationsKey = Symbol.for('@overkill-dev/assertion-observations/v1');

function isAssertionObservations(value: unknown): value is AssertionObservations {
    return value instanceof WeakMap;
}

function sharedObservations(): AssertionObservations {
    const existing: unknown = Reflect.get(globalThis, observationsKey);
    if (isAssertionObservations(existing)) {
        return existing;
    }
    const created: AssertionObservations = new WeakMap();
    Object.defineProperty(globalThis, observationsKey, { value: created });
    return created;
}

const observations = sharedObservations();

export function transferAssertionObservation(original: ProtocolRecord, admitted: ProtocolRecord): void {
    const observation = observations.get(original);
    if (observation !== undefined) {
        observations.set(admitted, observation);
    }
}

function evaluateForeignAssertion(
    assertion: ForeignAssertionNode,
    id: string,
    capture: boolean
): FailureEvidence | null {
    if (assertion.result.passed) {
        return null;
    }

    const { message, name, stack, thrown } = assertion.result.error;
    return {
        actual: serializeValue(assertion.label),
        diff: null,
        error: capture
            ? { message, name, stack, thrown: serializeValue(thrown), thrownEncoding: 'serialized' }
            : { message, name, stack, thrown },
        expected: serializeValue('foreign assertion pass'),
        id,
        kind: 'foreign',
        label: assertion.label,
        path: [],
        source: assertion.source,
        sourceLocations: assertion.sourceLocations,
        summary: assertion.message ?? assertion.summary
    };
}

function isNativeRegExpMethod(method: unknown, intrinsic: RegExp['exec'] | RegExp['test']): boolean {
    if (method === intrinsic) {
        return true;
    }

    if (typeof method !== 'function') {
        return false;
    }

    return Function.prototype.toString.call(method) === Function.prototype.toString.call(intrinsic);
}

function withPrivatePattern(
    assertion: BuiltInAssertAssertionNode<AssertionSource>
): BuiltInAssertAssertionNode<AssertionSource> {
    if (assertion.check !== 'match' && assertion.check !== 'not-match') {
        return assertion;
    }
    const { pattern } = assertion;
    if (
        !types.isRegExp(pattern) ||
        !isNativeRegExpMethod(pattern.test, RegExp.prototype.test) ||
        !isNativeRegExpMethod(pattern.exec, RegExp.prototype.exec)
    ) {
        return assertion;
    }
    const privatePattern = structuredClone(pattern);
    privatePattern.lastIndex = pattern.lastIndex;
    return { ...assertion, pattern: privatePattern };
}

function evaluateLeafAssertion(
    assertion: BuiltInAssertAssertionNode<AssertionSource>,
    id: string,
    capture: boolean
): FailureEvidence | null {
    const evaluation: AssertionEvaluation = {
        ...evaluateAssertionNode(assertion.check, capture ? withPrivatePattern(assertion) : assertion),
        summary: assertionSummary(assertion)
    };

    if (evaluation.passed) {
        return null;
    }

    return {
        actual: evaluation.actual,
        diff: evaluation.diff,
        expected: evaluation.expected,
        id,
        kind: 'leaf',
        path: evaluation.path,
        source: assertion.source,
        sourceLocations: assertion.sourceLocations,
        summary: evaluation.summary
    };
}

function evaluateChildEvidence(
    assertion: CompositeAssertionChildNode,
    id: string,
    capture: boolean
): FailureEvidence | null {
    return assertion.check === 'foreign'
        ? evaluateForeignAssertion(assertion, id, capture)
        : evaluateLeafAssertion(assertion, id, capture);
}

function evaluateEvidence(
    assertion: EvaluatedNode,
    id: string,
    capture: boolean,
    evaluateChild: (child: CompositeAssertionChildNode, id: string) => FailureEvidence | null
): FailureEvidence | null {
    if (assertion.check !== 'composite') {
        return evaluateChildEvidence(assertion, id, capture);
    }

    const children = assertion.children.flatMap(function childFailure(child, index) {
        return evaluateChild(child, `${id}.${index + 1}`) ?? [];
    });

    if (children.length === 0) {
        return null;
    }

    assertNonEmptyItems(children, 'Expected composite assertion failure to contain failed children.');

    return {
        actual: serializeValue(assertion.actual),
        children,
        diff: null,
        expected: serializeValue(assertion.expected),
        id,
        kind: 'composite',
        path: [],
        source: assertion.source,
        sourceLocations: assertion.sourceLocations,
        summary: assertionSummary(assertion)
    };
}

function rebaseFailure(failure: FailureEvidence, id: string, source: AssertionSource): FailureEvidence {
    if (failure.kind !== 'composite') {
        return { ...failure, id, source };
    }
    const prefixLength = failure.id.length;
    function rebaseChild(child: FailureEvidence): FailureEvidence {
        return rebaseFailure(child, id + child.id.slice(prefixLength), source);
    }

    const [ first, ...remaining ] = failure.children;
    return { ...failure, children: [ rebaseChild(first), ...remaining.map(rebaseChild) ], id, source };
}

function materializeFailure(failure: FailureEvidence): FailedCheck {
    const sourceLocations = resolveAssertionLocations(failure.sourceLocations);
    if (failure.kind !== 'composite') {
        return { ...failure, sourceLocations };
    }
    const [ first, ...remaining ] = failure.children;
    return {
        ...failure,
        children: [ materializeFailure(first), ...remaining.map(materializeFailure) ],
        sourceLocations
    };
}

function findInvalidOperand(
    assertion: EvaluatedNode,
    readObservation: (assertion: EvaluatedNode) => Observation | undefined
): InvalidDeepAssertionOperand | null {
    const observation = readObservation(assertion);
    if (observation !== undefined) {
        return observation.kind === 'invalid' ? observation.operand : null;
    }
    if (assertion.check !== 'composite') {
        return invalidLeafOperand(assertion);
    }
    for (const child of assertion.children) {
        const invalid = findInvalidOperand(child, readObservation);
        if (invalid !== null) {
            return invalid;
        }
    }
    return null;
}

function noObservation(): undefined {
    return undefined;
}

function assertionObservation(assertion: EvaluatedNode): Observation | undefined {
    return observations.get(assertion);
}

export function invalidDeepAssertionOperand(assertion: EvaluatedNode): InvalidDeepAssertionOperand | null {
    return findInvalidOperand(assertion, noObservation);
}

export function recordedInvalidDeepAssertionOperand(assertion: EvaluatedNode): InvalidDeepAssertionOperand | null {
    const observation = assertionObservation(assertion);
    if (observation === undefined) {
        return invalidDeepAssertionOperand(assertion);
    }

    return observation.kind === 'invalid' ? observation.operand : null;
}

function observedFailure(observation: Observation): FailureEvidence | null {
    if (observation.kind === 'exception') {
        throw observation.error;
    }
    return observation.kind === 'evaluated' ? observation.failure : null;
}

const passedObservation: Observation = { kind: 'evaluated', failure: null };

function captureObservation(
    assertion: EvaluatedNode,
    evaluateChild: (child: CompositeAssertionChildNode, id: string) => FailureEvidence | null
): Observation {
    const operand = findInvalidOperand(assertion, assertionObservation);
    if (operand !== null) {
        return { kind: 'invalid', operand };
    }
    const failure = evaluateEvidence(assertion, '1', true, evaluateChild);
    return failure === null ? passedObservation : { kind: 'evaluated', failure };
}

function observeSafely(
    assertion: EvaluatedNode,
    evaluateChild: (child: CompositeAssertionChildNode, id: string) => FailureEvidence | null
): Observation {
    try {
        return captureObservation(assertion, evaluateChild);
    } catch (error: unknown) {
        if (isTestControlError(error)) {
            throw error;
        }
        return { kind: 'exception', error };
    }
}

function observeAssertion(assertion: EvaluatedNode): Observation {
    const existing = assertionObservation(assertion);
    if (existing !== undefined) {
        return existing;
    }

    function evaluateChild(child: CompositeAssertionChildNode, id: string): FailureEvidence | null {
        const failure = observedFailure(observeAssertion(child));
        return failure === null ? null : rebaseFailure(failure, id, child.source);
    }

    const observation = observeSafely(assertion, evaluateChild);
    observations.set(assertion, observation);
    return observation;
}

function rawChildEvidence(child: CompositeAssertionChildNode, id: string): FailureEvidence | null {
    return evaluateChildEvidence(child, id, false);
}

export function captureAssertion(assertion: EvaluatedNode): void {
    observeAssertion(assertion);
}

export function evaluateAssertion(assertion: EvaluatedNode, id: number | string): FailedCheck | null {
    const failure = evaluateEvidence(assertion, String(id), false, rawChildEvidence);
    return failure === null ? null : materializeFailure(failure);
}

function recordedFailure(assertion: EvaluatedNode): FailureEvidence | null {
    const observation = observations.get(assertion);
    return observation === undefined
        ? evaluateEvidence(assertion, '1', false, rawChildEvidence)
        : observedFailure(observation);
}

export function evaluateRecordedAssertion(assertion: EvaluatedNode, id: number | string): FailedCheck | null {
    const observation = observations.get(assertion);
    if (observation === undefined) {
        return evaluateAssertion(assertion, id);
    }
    const failure = observedFailure(observation);
    return failure === null ? null : materializeFailure(rebaseFailure(failure, String(id), assertion.source));
}

export function assertionPasses(assertion: AssertionNode): boolean {
    return recordedFailure(assertion) === null;
}

function compositePropertyBoundary(
    assertion: CompositeAssertionNode,
    child: CompositeAssertionChildNode | undefined
): AssertAssertionNode {
    if (child === undefined) {
        throw new Error('Failed property composite requires a failed child.');
    }
    return { ...assertion, children: [ { ...child, source: 'assert' } ], source: 'assert' };
}

function rawPropertyBoundary(assertion: AssertionNode): AssertAssertionNode {
    if (assertion.check !== 'composite') {
        return { ...assertion, source: 'assert' };
    }
    return compositePropertyBoundary(
        assertion,
        assertion.children.find(function failedChild(candidate) {
            return evaluateAssertion(candidate, 1) !== null;
        })
    );
}

function observedPropertyBoundary(
    assertion: CompositeAssertionNode,
    failure: FailureEvidence | null
): AssertAssertionNode {
    if (failure?.kind !== 'composite') {
        throw new Error('Expected composite property failure evidence.');
    }
    const primaryFailure = failure.children[0];
    const childIndex = Number(primaryFailure.id.slice(failure.id.length + 1)) - 1;
    const boundary = compositePropertyBoundary(assertion, assertion.children[childIndex]);
    observations.set(boundary, {
        kind: 'evaluated',
        failure: { ...failure, children: [ primaryFailure ] }
    });
    return boundary;
}

export function propertyAssertionBoundary(assertion: AssertionNode): AssertAssertionNode {
    const observation = assertionObservation(assertion);
    if (observation === undefined) {
        return rawPropertyBoundary(assertion);
    }
    if (assertion.check === 'composite') {
        return observedPropertyBoundary(assertion, observedFailure(observation));
    }
    const boundary: AssertAssertionNode = { ...assertion, source: 'assert' };
    observations.set(boundary, observation);
    return boundary;
}
