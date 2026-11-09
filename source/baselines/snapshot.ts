import {
    createCompositeAssertionReferenceRecord,
    type CompositeAssertionReference,
    type CompositeAssertionReturn
} from '../packages/engine/assertion-protocol.entry-point.ts';
import type { BaselineJson } from './baseline-model.ts';
import { evaluateSnapshot, type SnapshotInput } from './snapshot-context.ts';

type SnapshotReference<Value> = CompositeAssertionReference<
    readonly [name: string, actual: Value],
    Promise<CompositeAssertionReturn<'assert'>>
>;

function isObject(value: unknown): boolean {
    return value !== null && typeof value === 'object';
}

function snapshotReference<Value>(
    name: string,
    input: (name: string, actual: Value) => SnapshotInput
): SnapshotReference<Value> {
    return createCompositeAssertionReferenceRecord({
        kind: 'composite',
        name,
        formatSummary: null,
        async run(metadata): Promise<CompositeAssertionReturn<'assert'>> {
            const [ snapshotName, actual ] = metadata.parameters;
            const comparison = await evaluateSnapshot(input(snapshotName, actual));
            const common = {
                source: metadata.source,
                sourceLocations: metadata.sourceLocations,
                message: metadata.message
            };
            if (comparison.kind === 'compare') {
                return {
                    ...common,
                    check: isObject(comparison.actual) && isObject(comparison.expected)
                        ? 'deep-equal'
                        : 'equal',
                    actual: comparison.actual,
                    expected: comparison.expected
                };
            }
            return {
                ...common,
                message: comparison.kind === 'missing' ? `Missing snapshot: ${snapshotName}` : common.message,
                check: 'true',
                actual: comparison.kind === 'accepted'
            };
        }
    });
}

export const snapshot = Object.freeze({
    text: snapshotReference<string>('text snapshot', function textInput(name, actual) {
        return { name, kind: 'text', actual };
    }),
    value: snapshotReference<BaselineJson>('JSON snapshot', function valueInput(name, actual) {
        return { name, kind: 'value', actual };
    }),
    bytes: snapshotReference<Uint8Array>('binary snapshot', function byteInput(name, actual) {
        return { name, kind: 'bytes', actual };
    })
});
