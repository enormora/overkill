import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';

const outputRendererBrand: unique symbol = Symbol.for('@overkill-dev/engine/output-renderer') as never;

export type OutputIntentRole = 'primary' | 'supplemental';
export type OutputIntentSeverity = 'error' | 'notice' | 'warning';

export type OutputIntentAnnotation = {
    readonly location: SourceLocation | null;
    readonly severity: OutputIntentSeverity;
    readonly title: string | null;
};

export type OutputLineIntent = {
    readonly annotation: OutputIntentAnnotation | null;
    readonly kind: 'stderr-line' | 'stdout-line';
    readonly role: OutputIntentRole;
    readonly text: string;
};

export type ReporterOutput = readonly OutputLineIntent[];
export type OptionalReporterOutput = ReporterOutput | undefined;

export type OutputRenderer = {
    readonly render: (intent: OutputLineIntent) => string;
};
export type DefinedOutputRenderer<OutputRendererValue extends OutputRenderer = OutputRenderer> =
    OutputRendererValue & {
        readonly [outputRendererBrand]: true;
    };

export type OutputLineWriter = {
    readonly writeLine: (line: string) => void;
};

export function defineOutputRenderer<OutputRendererValue extends OutputRenderer>(
    outputRenderer: OutputRendererValue
): DefinedOutputRenderer<OutputRendererValue> {
    Object.defineProperty(outputRenderer, outputRendererBrand, {
        enumerable: false,
        value: true
    });

    return outputRenderer as DefinedOutputRenderer<OutputRendererValue>;
}

export function isOutputRenderer(value: unknown): value is DefinedOutputRenderer {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, outputRendererBrand);
}

export function createPlainOutputRenderer(): DefinedOutputRenderer<OutputRenderer> {
    return defineOutputRenderer({
        render(intent) {
            return intent.text;
        }
    });
}
