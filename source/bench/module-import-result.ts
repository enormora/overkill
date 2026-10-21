import type { ModuleImportSession } from './module-import-session.ts';
import type { MeasuredModuleImport, ModuleImportObservation } from './module-measurement.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import type { ProcessObservation } from './process-observation.ts';
import { microsecondsPerSecond } from './measurement-units.ts';
import { timelineContext } from './timeline-context.ts';

type ImportReport = Awaited<ReturnType<ModuleImportSession['report']>>;

export function moduleObservation(report: ImportReport, startup: number): ModuleImportObservation {
    return {
        url: report.url,
        nodeVersion: report.nodeVersion,
        nodeArguments: report.nodeArguments,
        durationMicroseconds: report.durationMicroseconds,
        processStartupMilliseconds: startup,
        failure: report.failure
    };
}

export function recordModuleTimeline(observation: ModuleImportObservation): void {
    const timeline = timelineContext.getStore();
    if (timeline === undefined) {
        return;
    }
    const attribution = timeline.attribution();
    timeline.append({
        ...attribution,
        name: 'module import',
        source: 'process',
        clockDomain: `module:${attribution.phase}:${attribution.sample}`,
        startMicroseconds: 0,
        durationMicroseconds: observation.durationMicroseconds,
        outcome: observation.failure === null ? 'complete' : 'failed'
    });
}

export function moduleImportResult(
    observation: ModuleImportObservation,
    output: ProcessObservation['output'],
    outputBytes: MeasuredModuleImport['metrics']['outputBytes']
): MeasuredModuleImport {
    const provenance = { collector: 'module-import-v1', scope: 'process' as const, unit: 'microseconds' };
    const throughput = { ...provenance, unit: 'operations/second' };
    return {
        value: {
            url: observation.url,
            nodeVersion: observation.nodeVersion,
            nodeArguments: observation.nodeArguments,
            output
        },
        metrics: {
            durationMicroseconds: availableMetric(observation.durationMicroseconds, provenance),
            operationsPerSecond: observation.durationMicroseconds === 0
                ? unavailableMetric('Measured duration is zero.', throughput)
                : availableMetric(microsecondsPerSecond / observation.durationMicroseconds, throughput),
            processStartupMilliseconds: availableMetric(observation.processStartupMilliseconds, {
                ...provenance,
                unit: 'milliseconds'
            }),
            outputBytes
        }
    };
}
