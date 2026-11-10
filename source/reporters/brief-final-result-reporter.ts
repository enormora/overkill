import { defineReporter, type DefinedReporter, type FinalResultReporter } from '../engine/reporter.ts';
import {
    briefReporterSinks,
    type BriefReporterSinks,
    briefSummaryIntents,
    briefFailureIntents,
    runnerErrorIntent
} from './brief-reporter-rendering.ts';

export function createBriefFinalResultReporter(): DefinedReporter<FinalResultReporter<BriefReporterSinks>> {
    return defineReporter(function createBriefFinalResultRuntimeReporter(context) {
        return {
            dispose: null,
            kind: 'final-result',
            name: 'brief-final-result',
            sinks: briefReporterSinks,

            onResult(result) {
                return [
                    ...briefFailureIntents(result, context),
                    ...result.runnerErrors.map(runnerErrorIntent),
                    ...briefSummaryIntents(result)
                ];
            }
        };
    });
}
