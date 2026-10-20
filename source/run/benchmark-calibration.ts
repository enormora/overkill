import { execFile, type ExecFileOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCalibrationHostMetadata, calibrationMachineClass } from '../bench/calibration-machine.ts';
import type { BenchmarkNormalizationContext } from '../engine/benchmark-result.ts';
import type { BenchmarkProfileConfig } from '../config/types.ts';
import { benchmarkCalibrationSchema, type BenchmarkCalibrationResult } from '../bench/calibration-schema.ts';
import { childProcessEntryPointUrl } from './child-process.entry-point.ts';
import { benchmarkCalibrationRole, childRoleArgument } from './child-process-roles.ts';
import { readProcessEnvironment } from './node-host-readers.ts';
import { sanitizedChildEnvironment } from './supervised-child-process.ts';

type CalibrationRequest = {
    readonly cwd: string;
    readonly profile: BenchmarkProfileConfig;
};
type ComparableCalibration = Extract<BenchmarkCalibrationResult, { readonly kind: 'comparable'; }>;

async function calibrationOutput(args: readonly string[], options: ExecFileOptions): Promise<string> {
    return new Promise(function captureCalibration(resolve, reject) {
        execFile(process.execPath, args, options, function completed(error: Error | null, stdout: Buffer | string) {
            if (error === null) {
                resolve(stdout.toString());
            } else {
                reject(error);
            }
        });
    });
}

function calibrationNodeArguments(execution: BenchmarkProfileConfig['execution']): readonly string[] {
    if (execution.processModel !== 'worker-pool') {
        return [];
    }
    return execution.hostProcess.kind === 'child' ? execution.hostProcess.nodeArguments : Array.from(process.execArgv);
}

export function benchmarkNormalizationMachine(
    execution: BenchmarkProfileConfig['execution'],
    calibration: ComparableCalibration | null
): BenchmarkNormalizationContext['machine'] {
    const metadata = readCalibrationHostMetadata(calibrationNodeArguments(execution));
    return calibration === null
        ? { machineClass: calibrationMachineClass(metadata), metadata }
        : { machineClass: calibration.machineClass, metadata: calibration.metadata };
}

export async function collectBenchmarkCalibration(input: CalibrationRequest): Promise<BenchmarkCalibrationResult> {
    const nodeArguments = calibrationNodeArguments(input.profile.execution);
    const stdout = await calibrationOutput([
        ...nodeArguments,
        fileURLToPath(childProcessEntryPointUrl),
        childRoleArgument(benchmarkCalibrationRole)
    ], {
        cwd: input.cwd,
        env: sanitizedChildEnvironment(readProcessEnvironment(process), 'benchmark'),
        maxBuffer: 65_536,
        timeout: input.profile.timeouts.collectionMilliseconds
    });
    const parsed: unknown = JSON.parse(stdout);
    return benchmarkCalibrationSchema.parse(parsed);
}
