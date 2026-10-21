import { createStoredValue } from '../stored-value.ts';
import type { ModuleSample, ModuleImportRequest, MeasuredModuleImport } from './module-measurement.ts';
import type { ProcessSamplingSession } from './process-sampling.ts';
import type { ProcessPhase } from './process-evidence.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';
import { timelineSpan } from './timeline-context.ts';
import { importInProcess } from './module-import-execution.ts';

export type ModuleSampleLifetime = {
    readonly sample: ModuleSample;
    readonly ensureMeasured: () => void;
    readonly dispose: () => Promise<void>;
};

async function settleImport(pending: Promise<MeasuredModuleImport> | null): Promise<void> {
    try {
        await pending;
    } catch {}
}

export function createModuleSample(processes: ProcessSamplingSession, phase: ProcessPhase): ModuleSampleLifetime {
    const processSample = processes.sample(phase);
    const complete = createStoredValue(false);
    const state = {
        begun: false,
        violated: false,
        pending: null as Promise<MeasuredModuleImport> | null
    };
    async function importOnce(request: ModuleImportRequest): Promise<MeasuredModuleImport> {
        if (state.begun) {
            state.violated = true;
            throw new MeasurementContractError('Each sample must import exactly one module.', {});
        }
        state.begun = true;
        const result = await timelineSpan('process', 'module process', async function measureModuleImport() {
            return await importInProcess(request, processSample, processes.moduleImport);
        });
        complete.write(true);
        return result;
    }
    return {
        sample: {
            async importModule(request) {
                const pending = importOnce(request);
                if (state.pending === null) {
                    state.pending = pending;
                }
                return pending;
            }
        },
        ensureMeasured() {
            if (!complete.read() || state.violated) {
                throw new MeasurementContractError('Each sample must await exactly one successful module import.', {});
            }
            processSample.ensureMeasured();
        },
        async dispose() {
            try {
                await processSample.dispose();
            } finally {
                await settleImport(state.pending);
            }
        }
    };
}
