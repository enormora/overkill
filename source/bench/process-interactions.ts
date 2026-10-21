import type { ProcessChild, ProcessExit } from './process-child.ts';
import type { ProcessCompletion, ProcessStep } from './process-script.ts';
import type { ProcessOutput } from './process-output.ts';
import type { MetricReadings } from './measurement-types.ts';
import { availableMetric } from './metric-reading.ts';
import { nanosecondsPerMicrosecond } from './measurement-units.ts';
import { processCheckpoint } from './process-timeline.ts';

export type ProcessCompletionResult = {
    readonly time: bigint;
    readonly exit: ProcessExit | null;
    readonly interactions: MetricReadings;
    readonly readiness: bigint | null;
};
type InteractionStep = Extract<ProcessStep, { readonly kind: 'interaction'; }>;
type ExitCompletion = Extract<ProcessCompletion, { readonly kind: 'exit'; }>;
type ScriptCompletion = Exclude<ProcessCompletion, { readonly kind: 'ready'; }>;

async function measuredInteraction(
    step: InteractionStep,
    child: ProcessChild,
    output: ProcessOutput
): Promise<MetricReadings> {
    const observed = output.expect(step.marker, 'response');
    const started = process.hrtime.bigint();
    const [ , finished ] = await Promise.all([ child.write(step.input), observed ]);
    return {
        [`interaction.${step.name}.durationMicroseconds`]: availableMetric(
            Number(finished - started) / nanosecondsPerMicrosecond,
            {
                collector: 'process-interaction-v1',
                scope: 'process',
                unit: 'microseconds'
            }
        )
    };
}

async function performStep(step: ProcessStep, child: ProcessChild, output: ProcessOutput): Promise<MetricReadings> {
    if (step.kind === 'interaction') {
        return await measuredInteraction(step, child, output);
    }
    if (step.kind === 'write') {
        await child.write(step.text);
    } else if (step.kind === 'close-input') {
        child.closeInput();
    } else if (step.kind === 'resize') {
        child.resize(step.columns, step.rows);
    } else {
        await output.expect(step.marker, 'script');
    }
    return {};
}

async function processScript(
    steps: readonly ProcessStep[],
    child: ProcessChild,
    output: ProcessOutput
): Promise<MetricReadings> {
    const readings: Record<string, MetricReadings[string]> = {};
    for (const step of steps) {
        const name = step.kind === 'interaction' ? `interaction:${step.name}` : step.kind;
        Object.assign(
            readings,
            await processCheckpoint(name, async function completeStep() {
                return await performStep(step, child, output);
            })
        );
    }
    return readings;
}

async function expectedExit(completion: ExitCompletion, child: ProcessChild): Promise<ProcessExit> {
    const exit = await child.exit;
    if (exit.signal !== null || exit.code === null || !completion.expectedExitCodes.includes(exit.code)) {
        throw new Error(`Process exited unexpectedly: code ${String(exit.code)}, signal ${String(exit.signal)}.`);
    }
    return exit;
}

async function scriptedCompletion(
    completion: ScriptCompletion,
    child: ProcessChild,
    output: ProcessOutput
): Promise<ProcessCompletionResult> {
    const marker = completion.readiness;
    const readiness = marker === null
        ? Promise.resolve(null)
        : processCheckpoint('readiness', async function ready() {
            return await output.expect(marker, 'readiness');
        });
    const exit = completion.kind === 'exit'
        ? processCheckpoint('exit', async function exited() {
            return await expectedExit(completion, child);
        })
        : Promise.resolve(null);
    const [ interactions, ready, exited ] = await Promise.all([
        processScript(completion.steps, child, output),
        readiness,
        exit
    ]);
    return { time: exited?.time ?? process.hrtime.bigint(), readiness: ready, interactions, exit: exited };
}

export async function completeProcess(
    completion: ProcessCompletion,
    child: ProcessChild,
    output: ProcessOutput
): Promise<ProcessCompletionResult> {
    if (completion.kind !== 'ready') {
        return await scriptedCompletion(completion, child, output);
    }
    const time = await processCheckpoint('readiness', async function ready() {
        return await output.expect(completion.marker, 'readiness');
    });
    return { time, readiness: time, interactions: {}, exit: null };
}
