import { defineOutputRenderer, type DefinedOutputRenderer, type OutputRenderer } from '../engine/reporter-output.ts';
import { defineReporter, type DefinedReporter, type Reporter } from '../engine/reporter.ts';

type FixedRenderer<Renderer extends OutputRenderer> = DefinedOutputRenderer<Renderer> & Renderer;

export type FixedDefinedOutputRenderer<Renderer extends OutputRenderer = OutputRenderer> = FixedRenderer<Renderer>;

export type FixedDefinedReporter<ReporterValue extends Reporter = Reporter> = DefinedReporter<ReporterValue>;

export function defineFixedOutputRenderer<Renderer extends OutputRenderer>(
    outputRenderer: Renderer
): FixedDefinedOutputRenderer<Renderer> {
    return Object.assign(
        defineOutputRenderer(function createFixedRuntimeOutputRenderer() {
            return outputRenderer;
        }),
        outputRenderer
    );
}

export function defineFixedReporter<ReporterValue extends Reporter>(
    reporter: ReporterValue
): FixedDefinedReporter<ReporterValue> {
    const reporterDefinition = defineReporter(function createFixedRuntimeReporter() {
        return reporter;
    });

    return Object.defineProperties(
        reporterDefinition,
        Object.getOwnPropertyDescriptors(reporter)
    );
}
