import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { ReportingContext } from './reporting-context.ts';

const outputRendererBrand = Symbol.for('@overkill-dev/engine/output-renderer');

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
type RendererFactory<Renderer extends OutputRenderer> = (
    context: ReportingContext
) => Renderer;
type Brand = {
    readonly [outputRendererBrand]: true;
};
export type DefinedOutputRenderer<Renderer extends OutputRenderer = OutputRenderer> = Brand & RendererFactory<Renderer>;

export type OutputLineWriter = {
    readonly writeLine: (line: string) => void;
};

export function defineOutputRenderer<Renderer extends OutputRenderer>(
    createOutputRenderer: RendererFactory<Renderer>
): DefinedOutputRenderer<Renderer> {
    return Object.assign(createOutputRenderer, { [outputRendererBrand]: true as const });
}

export function isOutputRenderer(value: unknown): value is DefinedOutputRenderer {
    return typeof value === 'function' && Object.hasOwn(value, outputRendererBrand);
}

export function createPlainOutputRenderer(): DefinedOutputRenderer {
    return defineOutputRenderer(function createPlainRuntimeOutputRenderer() {
        return {
            render(intent) {
                return intent.text;
            }
        };
    });
}
