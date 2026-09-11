import type { TestBody, ThrowingTestBody } from '../engine/engine.entry-point.ts';

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

export function readAuthoringThrowingTestBody(value: unknown): ThrowingTestBody {
    if (!isAuthoringThrowingTestBody(value)) {
        throw new TypeError('Test case body must be a function.');
    }

    return value;
}
