import type { NarrowingCompositeAssertionReference } from '../packages/engine/assertion-protocol.entry-point.ts';
import type {
    AssertionOptions,
    InstanceConstructor,
    ResolvableSourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import { sourceLocationsWithCurrentForwarding } from '../assertion-protocol/source-location-forwarding.ts';
import { captureSourceLocation } from '../assertion-protocol/source-location.ts';
import {
    recordRequireReference,
    type RequireAssertionSink
} from './custom-assertion-recording.ts';

export type RequireAssertionFacade = {
    <Actual, Narrowed extends Actual, Arguments extends readonly unknown[]>(
        reference: NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments>,
        actual: Actual,
        ...parameters: Arguments
    ): asserts actual is Narrowed;
    readonly annotated: (message: string) => RequireAssertionFacade;
    readonly array: (actual: unknown, options?: AssertionOptions) => asserts actual is readonly unknown[];
    readonly boolean: (actual: unknown, options?: AssertionOptions) => asserts actual is boolean;
    readonly defined: <Value>(actual: Value, options?: AssertionOptions) => asserts actual is NonNullable<Value>;
    readonly function: (
        actual: unknown,
        options?: AssertionOptions
    ) => asserts actual is (...parameters: readonly unknown[]) => unknown;
    readonly hasProperty: <Key extends PropertyKey>(
        actual: unknown,
        key: Key,
        options?: AssertionOptions
    ) => asserts actual is Readonly<Record<Key, unknown>>;
    readonly instanceOf: <Constructor extends InstanceConstructor>(
        actual: unknown,
        expected: Constructor,
        options?: AssertionOptions
    ) => asserts actual is InstanceType<Constructor>;
    readonly notNull: <Value>(actual: Value, options?: AssertionOptions) => asserts actual is Exclude<Value, null>;
    readonly null: (actual: unknown, options?: AssertionOptions) => asserts actual is null;
    readonly number: (actual: unknown, options?: AssertionOptions) => asserts actual is number;
    readonly object: (
        actual: unknown,
        options?: AssertionOptions
    ) => asserts actual is Readonly<Record<PropertyKey, unknown>>;
    readonly string: (actual: unknown, options?: AssertionOptions) => asserts actual is string;
};

type RequireAssertionMethods = Pick<RequireAssertionFacade, keyof RequireAssertionFacade>;

function messageFromOptions(options: AssertionOptions | undefined, annotation: string | null): string | null {
    return options?.message ?? annotation;
}

export function createRecordingRequireFacadeWithLocation(
    sink: RequireAssertionSink,
    annotation: string | null,
    captureLocation: () => ResolvableSourceLocation
): RequireAssertionFacade {
    const methods: RequireAssertionMethods = {
        annotated(message) {
            return createRecordingRequireFacadeWithLocation(sink, message, captureLocation);
        },

        array(actual, options) {
            sink.recordRequire({
                actual,
                check: 'array',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        boolean(actual, options) {
            sink.recordRequire({
                actual,
                check: 'boolean',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        defined(actual, options) {
            sink.recordRequire({
                actual,
                check: 'defined',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        function(actual, options) {
            sink.recordRequire({
                actual,
                check: 'function',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        hasProperty(actual, key, options) {
            sink.recordRequire({
                actual,
                check: 'has-property',
                key,
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        instanceOf(actual, expected: InstanceConstructor, options) {
            sink.recordRequire({
                actual,
                check: 'instance-of',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        notNull(actual, options) {
            sink.recordRequire({
                actual,
                check: 'not-null',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        null(actual, options) {
            sink.recordRequire({
                actual,
                check: 'null',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        number(actual, options) {
            sink.recordRequire({
                actual,
                check: 'number',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        object(actual, options) {
            sink.recordRequire({
                actual,
                check: 'object',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        },

        string(actual, options) {
            sink.recordRequire({
                actual,
                check: 'string',
                message: messageFromOptions(options, annotation),
                source: 'require',
                sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
            });
        }
    };

    function callRequireReference<Actual, Narrowed extends Actual, Arguments extends readonly unknown[]>(
        reference: NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments>,
        actual: Actual,
        ...parameters: Arguments
    ): asserts actual is Narrowed;
    function callRequireReference(reference: unknown, ...parameters: readonly unknown[]): void {
        recordRequireReference({
            annotation,
            parameters,
            reference,
            sink,
            sourceLocations: sourceLocationsWithCurrentForwarding(captureLocation)
        });
    }

    return Object.assign(callRequireReference, methods);
}

export function createRecordingRequireFacade(
    sink: RequireAssertionSink,
    annotation: string | null
): RequireAssertionFacade {
    return createRecordingRequireFacadeWithLocation(sink, annotation, captureSourceLocation);
}
