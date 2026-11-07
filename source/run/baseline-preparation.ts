import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import type { RunPreparationInput, RunPreparationResult } from './prepared-run-types.ts';
import { createResultFromResolutionError, reportCollectionErrorResult } from './run-collection-error-result.ts';
import { RunCollectionError } from './run-errors.ts';
import { createOrdinaryBaselineWorkflow } from './baseline-workflow.ts';
import { createOrdinaryBaselineSession } from './baseline-session.ts';

export async function prepareOrdinaryBaselineRun(options: RunPreparationInput): Promise<RunPreparationResult> {
    const { profile, request } = options.input;
    if (profile.testFamily === 'benchmark' || profile.testFamily === 'type-test') {
        throw new Error('Expected ordinary baseline profile.');
    }
    const limits = profile.testFamily === 'integration' ? profile.attachments : defaultAttachmentLimits;
    const maxBytes = limits.maxArtifactBytes;
    try {
        const workflow = await createOrdinaryBaselineWorkflow({
            policy: profile.baselines,
            request,
            projectRoot: options.input.projectRoot,
            maxBytes
        });
        return {
            input: options.input,
            session: createOrdinaryBaselineSession({
                workflow,
                maxBytes,
                mode: request.baselineUpdateMode,
                dispatcher: options.dependencies.reporterDispatcher
            })
        };
    } catch (error: unknown) {
        const failure = new RunCollectionError(
            error instanceof Error ? error.message : String(error),
            { cause: error },
            'artifact'
        );
        return await reportCollectionErrorResult(
            options.command,
            options.dependencies,
            createResultFromResolutionError(failure, null),
            { timing: options.timing, benchmarkHost: null }
        );
    }
}
