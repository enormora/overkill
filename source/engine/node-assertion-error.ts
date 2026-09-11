import { AssertionError } from 'node:assert';
import type {
    CompositeAssertionNode,
    ForeignAssertionNode
} from '../assertion-protocol/assertion-node.ts';
import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import {
    sourceLocationFromStack
} from '../assertion-protocol/source-location.ts';
import { createThrownErrorRecord } from '../assertion-protocol/thrown-error-record.ts';

function assertionErrorSourceLocation(error: unknown, fallback: SourceLocation): SourceLocation {
    if (error instanceof Error && typeof error.stack === 'string') {
        const location = sourceLocationFromStack(error.stack);

        return location.kind === 'known' ? location : fallback;
    }

    return fallback;
}

export function isNodeAssertionError(error: unknown): boolean {
    if (error instanceof AssertionError) {
        return true;
    }

    if (typeof error !== 'object' || error === null || Array.isArray(error)) {
        return false;
    }

    return Reflect.get(error, 'name') === 'AssertionError' && Reflect.get(error, 'code') === 'ERR_ASSERTION';
}

export function nodeAssertionErrorFailure(
    error: unknown,
    fallbackLocation: SourceLocation
): CompositeAssertionNode<'assert'> {
    const sourceLocation = assertionErrorSourceLocation(error, fallbackLocation);
    const errorRecord = createThrownErrorRecord(error);
    const child: ForeignAssertionNode<'assert'> = {
        check: 'foreign',
        label: 'node:assert',
        message: null,
        result: {
            error: errorRecord,
            passed: false
        },
        source: 'assert',
        sourceLocations: [ sourceLocation ],
        summary: `node:assert: ${errorRecord.message}`
    };

    return {
        actual: 'thrown AssertionError',
        check: 'composite',
        children: [ child ],
        expected: 'node:assert pass',
        message: null,
        name: 'node:assert',
        source: 'assert',
        sourceLocations: [ sourceLocation ],
        summary: child.summary
    };
}
