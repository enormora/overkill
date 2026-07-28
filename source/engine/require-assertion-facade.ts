import type { NarrowingCompositeAssertionReference } from '../assertion-protocol/assertion-reference.ts';
import type { AssertionOptions, InstanceConstructor } from '../assertion-protocol/assertion-node-shape.ts';
import {
    recordRequireReference,
    type RequireAssertionSink
} from './custom-assertion-recording.ts';
import type { RequireAssertionFacade } from './assertion-facade.ts';

type RequireAssertionMethods = Pick<RequireAssertionFacade, keyof RequireAssertionFacade>;

function messageFromOptions(options: AssertionOptions | undefined, annotation: string | null): string | null {
    return options?.message ?? annotation;
}

export function createRecordingRequireFacade(
    sink: RequireAssertionSink,
    annotation: string | null
): RequireAssertionFacade {
    const methods: RequireAssertionMethods = {
        annotated(message) {
            return createRecordingRequireFacade(sink, message);
        },

        array(actual, options) {
            sink.recordRequire({
                actual,
                check: 'array',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        boolean(actual, options) {
            sink.recordRequire({
                actual,
                check: 'boolean',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        defined(actual, options) {
            sink.recordRequire({
                actual,
                check: 'defined',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        function(actual, options) {
            sink.recordRequire({
                actual,
                check: 'function',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        hasProperty(actual, key, options) {
            sink.recordRequire({
                actual,
                check: 'has-property',
                key,
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        instanceOf(actual, expected: InstanceConstructor, options) {
            sink.recordRequire({
                actual,
                check: 'instance-of',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        notNull(actual, options) {
            sink.recordRequire({
                actual,
                check: 'not-null',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        null(actual, options) {
            sink.recordRequire({
                actual,
                check: 'null',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        number(actual, options) {
            sink.recordRequire({
                actual,
                check: 'number',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        object(actual, options) {
            sink.recordRequire({
                actual,
                check: 'object',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        string(actual, options) {
            sink.recordRequire({
                actual,
                check: 'string',
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        }
    };

    function callRequireReference<Actual, Narrowed extends Actual, Arguments extends readonly unknown[]>(
        reference: NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments>,
        actual: Actual,
        ...parameters: Arguments
    ): asserts actual is Narrowed;
    function callRequireReference(reference: unknown, ...parameters: readonly unknown[]): void {
        recordRequireReference(sink, annotation, reference, parameters);
    }

    return Object.assign(callRequireReference, methods);
}
