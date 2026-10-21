import { fileURLToPath } from 'node:url';
import { moduleImportEntryPointUrl } from '../packages/bench/module-import.entry-point.ts';
import { createModuleImportSession, type ModuleImportSession } from './module-import-session.ts';
import type { MeasuredModuleImport, ModuleImportRequest, ModuleImportObservation } from './module-measurement.ts';
import { moduleObservation, moduleImportResult, recordModuleTimeline } from './module-import-result.ts';
import type { ProcessSamplingSession } from './process-sampling.ts';
import { withinProcessDeadline } from './process-deadline.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';

type ProcessSampleLifetime = ReturnType<ProcessSamplingSession['sample']>;
type ModuleRecorder = ProcessSamplingSession['moduleImport'];
const reportDeadlineMilliseconds = 1000;

function validateObservation(request: ModuleImportRequest, observation: ModuleImportObservation): void {
    if (observation.url !== request.url.href || observation.failure !== null) {
        throw new MeasurementContractError(observation.failure ?? 'Module import replied with a different URL.', {});
    }
}

async function measureImport(
    request: ModuleImportRequest,
    sample: ProcessSampleLifetime,
    session: ModuleImportSession,
    record: ModuleRecorder
): Promise<MeasuredModuleImport> {
    session.start();
    const processResult = await sample.sample.process({
        command: [
            process.execPath,
            ...request.nodeArguments,
            fileURLToPath(moduleImportEntryPointUrl),
            ...session.arguments,
            request.url.href
        ],
        cwd: request.cwd,
        env: request.env,
        io: { kind: 'pipes' },
        completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0, 1 ] }
    });
    const report = await withinProcessDeadline(
        session.report(),
        reportDeadlineMilliseconds,
        'Module exited without an import report.'
    );
    const observation = moduleObservation(report, session.startupMilliseconds());
    record(observation);
    recordModuleTimeline(observation);
    validateObservation(request, observation);
    return moduleImportResult(observation, processResult.value.output, processResult.metrics.outputBytes);
}

export async function importInProcess(
    request: ModuleImportRequest,
    sample: ProcessSampleLifetime,
    record: ModuleRecorder
): Promise<MeasuredModuleImport> {
    if (!(request.url instanceof URL) || request.url.protocol !== 'file:') {
        throw new MeasurementContractError('Module import requires an absolute file URL.', {});
    }
    const session = await createModuleImportSession();
    try {
        return await measureImport(request, sample, session, record);
    } finally {
        await session.close();
    }
}
