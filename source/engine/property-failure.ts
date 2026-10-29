import { serializeValue, type SerializedValue } from '../compare/serialized-value.ts';
import { assertionPasses } from '../assertion-protocol/evaluation.ts';
import { resolveSourceLocation, sourceLocationFromStack } from '../assertion-protocol/source-location.ts';
import type { AssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { assertionFailure } from './recorded-assertion-failure.ts';
import type { PropertyTrialResult } from './property-execution-host.ts';
import { propertyBoundary } from './property-trial-outcome.ts';

function locationKey(location: SourceLocation): string | null {
    return location.kind === 'known' && location.line !== null && location.column !== null
        ? JSON.stringify([ location.file.replaceAll('\\', '/'), location.line, location.column ])
        : null;
}

function assertionIdentity(assertion: AssertionNode): string | null {
    const location = locationKey(resolveSourceLocation(assertion.sourceLocations[0]));
    return location === null ? null : JSON.stringify([
        assertion.check,
        assertion.check === 'composite' ? assertion.name : null,
        location
    ]);
}

function exceptionConstructorName(value: unknown): string | null {
    return typeof value === 'function' && value.name.length > 0 ? value.name : null;
}

function exceptionType(thrown: unknown): string | null {
    if (!(thrown instanceof Error)) {
        return null;
    }
    const prototype: unknown = Object.getPrototypeOf(thrown);
    if (typeof prototype !== 'object' || prototype === null) {
        return null;
    }
    const typeConstructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    return exceptionConstructorName(typeConstructor);
}

function bodyIdentity(trial: Extract<PropertyTrialResult, { readonly kind: 'body-error'; }>): string | null {
    const error = trial.result.bodyError;
    if (error?.stack === null || error === null) {
        return null;
    }
    const location = locationKey(sourceLocationFromStack(error.stack));
    const type = exceptionType(error.thrown);
    return location === null || type === null ? null : JSON.stringify([ type, location ]);
}

export function propertyFailureIdentity(trial: PropertyTrialResult): string | null {
    if (trial.kind === 'assertion-failed') {
        const assertion = trial.result.returnedAssertions.find(function failed(value) {
            return !assertionPasses(value);
        });
        return assertion === undefined ? null : assertionIdentity(assertion);
    }
    if (trial.kind === 'body-error') {
        return bodyIdentity(trial);
    }
    return null;
}

export function matchPropertyFailure(
    target: PropertyTrialResult,
    candidate: PropertyTrialResult,
    identity: string,
    explicit: boolean
): PropertyTrialResult | null {
    if (target.kind !== candidate.kind) {
        return null;
    }
    if (explicit) {
        return candidate;
    }
    if (candidate.kind === 'assertion-failed') {
        const assertion = candidate.result.returnedAssertions.find(function matching(value) {
            return !assertionPasses(value) && assertionIdentity(value) === identity;
        });
        return assertion === undefined ? null : { ...candidate, assertion: propertyBoundary(assertion) };
    }
    return propertyFailureIdentity(candidate) === identity ? candidate : null;
}

export function propertyTrialEvidence(trial: PropertyTrialResult, failureKey: string | null): SerializedValue {
    return serializeValue(
        trial.kind === 'passed' ? { kind: 'passed' } : {
            kind: trial.kind,
            failureKey,
            identity: failureKey ?? propertyFailureIdentity(trial),
            assertions: assertionFailure(trial.result.returnedAssertions),
            bodyError: trial.result.bodyError,
            cleanupErrors: trial.result.cleanupErrors,
            contractFailures: trial.result.contractFailures,
            runnerErrors: trial.result.runnerErrors
        }
    );
}
