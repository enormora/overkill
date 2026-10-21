import { createStoredValue, type StoredValue } from '../stored-value.ts';
import {
    currentAttachmentLimits,
    defaultAttachmentLimits
} from '../packages/resources/attachment-context.entry-point.ts';
import { createProcessHelper, type ProcessHelper } from './process-helper.ts';
import type { ProcessMeasurementStrategy } from './process-measurement.ts';
import { createProcessEvidence, type ProcessEvidence, type ProcessPhase } from './process-evidence.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';
import { createProcessInvocation, type ProcessSampleLifetime } from './process-invocation.ts';
import type { ModuleImportObservation } from './module-measurement.ts';

export type ProcessSamplingSession = {
    readonly sample: (phase: ProcessPhase) => ProcessSampleLifetime;
    readonly moduleImport: (observation: ModuleImportObservation) => void;
    readonly dispose: () => Promise<void>;
};
type ProcessBenchmarkSession = {
    readonly strategy: ProcessMeasurementStrategy;
    readonly signal: AbortSignal;
    readonly evidence: ProcessEvidence;
    readonly helper: StoredValue<ProcessHelper | null>;
    readonly disposed: StoredValue<boolean>;
    readonly abort: () => void;
};

function getProcessHelper(session: ProcessBenchmarkSession): ProcessHelper {
    if (session.disposed.read()) {
        throw new MeasurementContractError('Process sampling session is closed.', {});
    }
    const maximum = defaultAttachmentLimits.maxInlineBytes;
    const maximumBytes = Math.min(currentAttachmentLimits()?.maxInlineBytes ?? maximum, maximum);
    const helper = session.helper.read() ?? createProcessHelper(session.strategy.instrumentation, maximumBytes);
    session.helper.write(helper);
    return helper;
}

async function closeSessionHelper(session: ProcessBenchmarkSession): Promise<void> {
    await session.helper.read()?.close();
}

async function disposeSession(session: ProcessBenchmarkSession): Promise<void> {
    if (session.disposed.read()) {
        return;
    }
    session.disposed.write(true);
    session.signal.removeEventListener('abort', session.abort);
    try {
        await closeSessionHelper(session);
    } finally {
        await session.evidence.retain();
    }
}

export function createProcessSamplingSession(
    strategy: ProcessMeasurementStrategy,
    signal: AbortSignal
): ProcessSamplingSession {
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
        throw new MeasurementContractError('Process benchmarks support Linux and macOS.', {});
    }
    const helper = createStoredValue<ProcessHelper | null>(null);
    const session: ProcessBenchmarkSession = {
        strategy,
        signal,
        helper,
        evidence: createProcessEvidence(),
        disposed: createStoredValue(false),
        abort() {
            helper.read()?.cancel();
        }
    };
    signal.addEventListener('abort', session.abort);
    return {
        moduleImport: session.evidence.moduleImport,
        sample(phase) {
            return createProcessInvocation({
                helper() {
                    return getProcessHelper(session);
                },
                signal,
                observe(execution) {
                    session.evidence.append(phase, execution);
                }
            });
        },
        async dispose() {
            await disposeSession(session);
        }
    };
}
