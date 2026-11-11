import { validateReporterRunFacts, type DefinedReporter } from '../engine/reporter.ts';
import { validateNormalizedConfig } from '../config/validation.ts';
import { invalidProfileNameMessage } from '../config/profile-patterns.ts';
import {
    isBuiltinTestProfile,
    type ProfileConfig,
    type ProcessBudgets,
    type NormalizedConfig
} from '../config/types.ts';
import { runSelectionValidationMessage } from './run-selection-schema.ts';
import { assertSupportedProcessEngine as assertSupportedProcessEngineSelection } from './run-process-engine.ts';
import { invalidRequest, RunResolutionError } from './run-errors.ts';
import { validateRunEngineSelection } from './run-engine-selection.ts';
import { currentExecutionSession } from './execution-session-context.ts';
import type { RunCommand, RunRequest } from './run-types.ts';

const minimumSeedValue = 0n;
const executionModes: ReadonlySet<string> = new Set([ 'profile-default', 'serial' ]);

export function validateRunShard(request: Pick<RunRequest, 'shard'>): void {
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

export function validateRunSeed(request: Pick<RunRequest, 'seed'>): void {
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
    const message = runSelectionValidationMessage(request.selection);

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

function validateMergeRecordingRequest(request: RunRequest): void {
    const recordForMerge: unknown = Reflect.get(request, 'recordForMerge');
    if (recordForMerge === undefined || recordForMerge === false) {
        return;
    }
    if (recordForMerge !== true) {
        invalidRequest('Record for merge must be a boolean.');
    }
    if (request.shard.total === 1) {
        invalidRequest('--record-for-merge requires more than one shard.');
    }
    if (request.record) {
        invalidRequest('Choose either --record or --record-for-merge.');
    }
}

function validateRunRequest(request: RunRequest): void {
    assertValidRunProfileName(request.profile);
    validateRunRecordingRequest(request);

    validatePositiveSafeInteger(request.workers, 'Worker count');
    validateRunShard(request);
    validateMergeRecordingRequest(request);
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

type Namespace = 'baseline' | 'bench' | 'bench-calibrate' | 'test';
function assertCapture(request: RunRequest, profile: ProfileConfig): void {
    if ((profile.testFamily === 'microtest' || profile.testFamily === 'property') && request.capture === 'live') {
        invalidRequest(
            `${profile.testFamily === 'microtest' ? 'Microtest' : 'Property'} profiles do not support live capture.`
        );
    }
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
function assertBaselineRequest(request: RunRequest, profile: ProfileConfig, namespace: Namespace): void {
    if (namespace === 'baseline' && !isBuiltinTestProfile(profile)) {
        invalidRequest('Ordinary baselines require a microtest, property, or integration profile.');
    }
    if ([ 'test', 'bench-calibrate' ].includes(namespace) && request.baselineUpdateMode !== 'none') {
        invalidRequest('Baseline updates and previews require baseline commands.');
    }
}
export function assertProfileRequestSupported(
    request: RunRequest,
    profile: ProfileConfig,
    namespace: Namespace,
    reporters: NormalizedConfig['reporters']
): void {
    if (request.recordForMerge && (namespace !== 'test' || currentExecutionSession() !== null)) {
        invalidRequest('--record-for-merge is only supported by ordinary runs outside execution sessions.');
    }
    assertAdapterRequest(request, profile);
    assertBaselineRequest(request, profile, namespace);
    assertExecution(request, profile);
    if (request.coverage && profile.testFamily !== 'microtest') {
        invalidRequest('Coverage can only be requested for microtest profiles.');
    }
    assertCapture(request, profile);
    assertProfileReportersSupported(profile, reporters);
}
