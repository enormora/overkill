import { validateReporterRunFacts, type DefinedReporter } from '../engine/reporter.ts';
import { validateNormalizedConfig } from '../config/validation.ts';
import { invalidProfileNameMessage } from '../config/profile-patterns.ts';
import type { ProfileConfig, ProcessBudgets, NormalizedConfig } from '../config/types.ts';
import { assertSupportedProcessEngine as assertSupportedProcessEngineSelection } from './run-process-engine.ts';
import { invalidRequest, RunResolutionError } from './run-errors.ts';
import { validateRunEngineSelection } from './run-engine-selection.ts';
import { invalidRunSelectionMessage } from './run-selection-filters.ts';
import type { RunCommand, RunRequest } from './run-types.ts';

const minimumSeedValue = 0n;
const executionModes: ReadonlySet<string> = new Set([ 'profile-default', 'serial' ]);

function validateRunShard(request: RunRequest): void {
    if (!Number.isSafeInteger(request.shard.total) || request.shard.total <= 0) {
        invalidRequest('Shard total must be a positive safe integer.');
    }

    if (!Number.isSafeInteger(request.shard.index) || request.shard.index <= 0) {
        invalidRequest('Shard index must be a positive safe integer.');
    }

    if (request.shard.index > request.shard.total) {
        invalidRequest('Shard index must not exceed shard total.');
    }
}

function validateRunSeed(request: RunRequest): void {
    if (request.seed.value !== null && request.seed.value < minimumSeedValue) {
        invalidRequest('Run seed must be a nonnegative bigint.');
    }
}

function validatePositiveSafeInteger(value: number | null, label: string): void {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
        invalidRequest(`${label} must be a positive safe integer.`);
    }
}

function validateProcessBudgets(processBudgets: ProcessBudgets): void {
    validatePositiveSafeInteger(processBudgets.activeResourceCount, 'Active Node resource count budget');
    validatePositiveSafeInteger(processBudgets.javaScriptEngineHeapBytes, 'JavaScript engine heap budget');
    validatePositiveSafeInteger(processBudgets.residentSetBytes, 'Resident set budget');
    validatePositiveSafeInteger(processBudgets.residentSetGrowthBytesPerSecond, 'Resident set growth budget');
}

function validateSamplingInterval(value: number | null): void {
    validatePositiveSafeInteger(value, 'Process usage sampling interval');
}

function hasProcessBudgets(processBudgets: ProcessBudgets): boolean {
    return processBudgets.activeResourceCount !== null ||
        processBudgets.javaScriptEngineHeapBytes !== null ||
        processBudgets.residentSetBytes !== null ||
        processBudgets.residentSetGrowthBytesPerSecond !== null;
}

function validateRunProcessUsageRequest(request: RunRequest): void {
    if (request.processBudgetOverrides !== null) {
        validateProcessBudgets(request.processBudgetOverrides);
    }

    validateSamplingInterval(request.processUsageSamplingIntervalMilliseconds);

    if (
        request.measureProcessUsage === false &&
        request.processBudgetOverrides !== null &&
        hasProcessBudgets(request.processBudgetOverrides)
    ) {
        invalidRequest('Process budget overrides require process usage measurement.');
    }
}

function validateRunSelection(request: RunRequest): void {
    const message = invalidRunSelectionMessage(request.selection);

    if (message !== null) {
        invalidRequest(message);
    }
}

function requestTimingCollection(request: RunRequest): unknown {
    return request.timingCollection;
}

function validateTimingCollection(request: RunRequest): void {
    const timingCollection = requestTimingCollection(request);

    if (timingCollection !== 'profile-default' && timingCollection !== 'precise') {
        invalidRequest('Timing collection must be "profile-default" or "precise".');
    }
}

function validateExecution(request: RunRequest): void {
    if (!executionModes.has(request.execution.mode)) {
        invalidRequest('Execution mode must be "profile-default" or "serial".');
    }
}

function assertValidRunProfileName(profileName: string): void {
    const message = invalidProfileNameMessage(profileName);

    if (message !== null) {
        invalidRequest(message);
    }
}

function validateRunRecordingRequest(request: RunRequest): void {
    if (typeof request.lastFailed !== 'boolean') {
        invalidRequest('Run lastFailed must be a boolean.');
    }
    if (typeof request.record !== 'boolean') {
        invalidRequest('Record must be a boolean.');
    }
}

function validateRunRequest(request: RunRequest): void {
    assertValidRunProfileName(request.profile);
    validateRunRecordingRequest(request);

    validatePositiveSafeInteger(request.workers, 'Worker count');
    validateRunShard(request);
    validateRunSeed(request);
    validateRunSelection(request);
    validateTimingCollection(request);
    validateExecution(request);
    validateRunProcessUsageRequest(request);
}

function validateRunCommand(command: RunCommand): void {
    validateRunEngineSelection(command.engine);
}

export function validateRunInput(command: RunCommand): void {
    validateRunCommand(command);
    validateRunRequest(command.request);
    validateNormalizedConfig(command.config);
}

export function assertSupportedProcessEngine(command: RunCommand, profile: ProfileConfig): void {
    assertSupportedProcessEngineSelection(command, profile);
}

function assertProfileReportersSupported(
    profile: ProfileConfig,
    fallback: readonly DefinedReporter[] | null
): void {
    const reporters = profile.reporters ?? fallback ?? [];
    for (const reporter of reporters) {
        try {
            validateReporterRunFacts(reporter, { execution: { testFamily: profile.testFamily } });
        } catch (error: unknown) {
            invalidRequest(error instanceof Error ? error.message : String(error));
        }
    }
}

type Namespace = 'bench' | 'bench-calibrate' | 'test';
function assertCapture(request: RunRequest, profile: ProfileConfig): void {
    if ((profile.testFamily === 'microtest' || profile.testFamily === 'property') && request.capture === 'live') {
        invalidRequest(
            `${profile.testFamily === 'microtest' ? 'Microtest' : 'Property'} profiles do not support live capture.`
        );
    }
}
function assertBaseline(namespace: Namespace, request: RunRequest): void {
    if (namespace === 'bench' || request.baselineUpdateMode === 'none') {
        return;
    }
    invalidRequest(
        'Ordinary baseline updates are not implemented. Use benchmark baseline commands for performance baselines.'
    );
}
function assertExecution(request: RunRequest, profile: ProfileConfig): void {
    if (
        request.execution.mode === 'serial' && profile.testFamily !== 'microtest' && profile.testFamily !== 'property'
    ) {
        throw new RunResolutionError(
            'Serial execution overrides require a microtest or property profile.',
            undefined,
            'unsupported-request'
        );
    }
    if (request.workers !== null && profile.execution.processModel !== 'worker-pool') {
        invalidRequest('Worker count can only be requested for worker-pool profiles.');
    }
}
function assertAdapterRequest(request: RunRequest, profile: ProfileConfig): void {
    if (profile.testFamily !== 'type-test') {
        return;
    }
    const unsupported = [
        request.capture !== 'buffered',
        request.measureProcessUsage === true,
        request.processBudgetOverrides !== null,
        request.processUsageSamplingIntervalMilliseconds !== null,
        request.timingCollection === 'precise'
    ];
    if (unsupported.includes(true)) {
        invalidRequest(
            'Adapter profiles do not support runtime capture, debugging, process budgets, or precise timings.'
        );
    }
}
export function assertProfileRequestSupported(
    request: RunRequest,
    profile: ProfileConfig,
    namespace: Namespace,
    reporters: NormalizedConfig['reporters']
): void {
    assertAdapterRequest(request, profile);
    assertBaseline(namespace, request);
    assertExecution(request, profile);
    if (request.coverage && profile.testFamily !== 'microtest') {
        invalidRequest('Coverage can only be requested for microtest profiles.');
    }
    assertCapture(request, profile);
    assertProfileReportersSupported(profile, reporters);
}
