import { serialize } from 'node:v8';
import type { OrdinaryBaselineEntry } from '../../../run/baseline-record.ts';
import type { RunResult } from '../../../packages/engine/engine.entry-point.ts';
import { orchestrator, type BaselineRunResult } from '../../../packages/run/run.entry-point.ts';
import { ordinaryBaselineProject } from '../../../test-support/ordinary-baseline-fixture.ts';

export type CoveredBaselineResult = {
    readonly updated: BaselineRunResult;
    readonly original: readonly OrdinaryBaselineEntry[];
    readonly compared: RunResult;
    readonly retained: readonly OrdinaryBaselineEntry[];
};

async function reconcileCoveredBaselines(directory: string): Promise<CoveredBaselineResult> {
    const data = await ordinaryBaselineProject(directory, 'in-process', 'text');
    const command = { ...data.command, request: { ...data.command.request, coverage: true } };
    const updated = await orchestrator.baseline.update(command, { timing: null });
    const original = await data.entries();
    data.setActual(43);
    const compared = await orchestrator.run(command, { timing: null });
    return { updated, original, compared, retained: await data.entries() };
}

const directory = process.argv[2];
if (directory === undefined) {
    throw new Error('A baseline project directory is required.');
}
process.stdout.write(serialize(await reconcileCoveredBaselines(directory)).toString('base64'));
