import { createRunReportingContext, type RunReportingContext } from './reporting-context.ts';
import {
    validateReporterRunFacts,
    validateReporterSinks,
    type DefinedReporter,
    type Reporter,
    type RunFacts
} from './reporter.ts';
import type { OutputRenderer, DefinedOutputRenderer } from './reporter-output.ts';

export type FinalDelivery = { readonly facts: RunFacts; readonly fallback: DefinedReporter; };
type Collector = { readonly addReporter: (reporter: Reporter) => void; readonly reporters: () => readonly Reporter[]; };
export type PreparedDelivery = { readonly reporters: readonly Reporter[]; readonly outputRenderer: OutputRenderer; };
type DeliveryDefinitions = {
    readonly definitions: readonly DefinedReporter[];
    readonly renderer: DefinedOutputRenderer;
    readonly final: FinalDelivery | null;
};
export function createDeliveryReportingContext(final: FinalDelivery | null): RunReportingContext {
    const reporting = createRunReportingContext();
    if (final !== null) {
        reporting.observeFacts(final.facts);
    }
    return reporting;
}
function selectedReporters(reporters: readonly Reporter[], final: FinalDelivery | null): readonly Reporter[] {
    return final === null ? reporters : reporters.filter(function finalReporter(reporter) {
        return reporter.kind === 'final-result';
    });
}
function collectDefinition(
    collector: Collector,
    definition: DefinedReporter,
    reporting: RunReportingContext,
    final: FinalDelivery | null
): void {
    const reporter = definition(reporting.context);
    collector.addReporter(reporter);
    if (final !== null && reporter.kind === 'final-result') {
        validateReporterRunFacts(definition, final.facts);
    }
}
export function prepareReporterDelivery(
    collector: Collector,
    options: DeliveryDefinitions,
    reporting: RunReportingContext
): PreparedDelivery {
    const { final, definitions, renderer } = options;
    for (const definition of definitions) {
        collectDefinition(collector, definition, reporting, final);
    }
    if (final !== null && selectedReporters(collector.reporters(), final).length === 0) {
        collectDefinition(collector, final.fallback, reporting, final);
    }
    const reporters = selectedReporters(collector.reporters(), final);
    validateReporterSinks(reporters);
    return { reporters, outputRenderer: renderer(reporting.context) };
}
