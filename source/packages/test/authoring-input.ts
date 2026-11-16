import { z } from 'zod/v4';
import {
    isBodyReference,
    type BodyReference,
    type ThrowingTestScope,
    type TestBody,
    type ThrowingTestBody
} from '../engine/engine.entry-point.ts';

export function isAuthoringRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readAuthoringRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
    if (!isAuthoringRecord(value)) {
        throw new TypeError(message);
    }

    return value;
}

export function readAuthoringString(value: unknown, message: string): string {
    if (typeof value !== 'string') {
        throw new TypeError(message);
    }

    return value;
}

function isAuthoringTestBody(value: unknown): value is TestBody {
    return typeof value === 'function';
}

function isAuthoringThrowingTestBody(value: unknown): value is ThrowingTestBody {
    return typeof value === 'function';
}

export function readAuthoringTestBody(value: unknown): TestBody {
    if (!isAuthoringTestBody(value)) {
        throw new TypeError('Test case body must be a function.');
    }

    return value;
}

export function readAuthoringThrowingTestBody(
    value: unknown
): BodyReference<ThrowingTestScope, ReturnType<ThrowingTestBody>> | ThrowingTestBody {
    if (isBodyReference(value)) {
        return z.custom<BodyReference<ThrowingTestScope, ReturnType<ThrowingTestBody>>>(isBodyReference).parse(value);
    }
    if (!isAuthoringThrowingTestBody(value)) {
        throw new TypeError('Test case body must be a function.');
    }

    return value;
}

export function readAuthoringTestImplementation(value: unknown): BodyReference | TestBody {
    return isBodyReference(value)
        ? z.custom<BodyReference>(isBodyReference).parse(value)
        : readAuthoringTestBody(value);
}
