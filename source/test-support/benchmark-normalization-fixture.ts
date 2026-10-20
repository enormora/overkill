import { mkdtemp, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createNullReporter } from '../reporters/null-reporter.ts';
import type { TestScope } from '../packages/test/test.entry-point.ts';
import { normalizeConfig, type RunCommand } from '../packages/run/run.entry-point.ts';
import { createCalibrationReferenceStore, type CalibrationReferenceStore } from '../baselines/calibration-store.ts';
import { defaultRunRequest } from './run-command-factory.ts';

const fixture = 'source/integration-tests/run/fixtures/normalization.bench.test.ts';
export type Boundary = 'fresh-worker-per-unit' | 'reuse' | 'supervised-process';
export async function normalizationCommand(scope: TestScope, boundary: Boundary, title: string): Promise<RunCommand> {
    const directory = await mkdtemp(join(process.cwd(), 'target/normalization-'));
    scope.cleanup(async function removeFixture() {
        await rm(directory, { recursive: true, force: true });
    });
    return {
        config: normalizeConfig({
            runtimeStateDir: join(directory, 'state'),
            reporters: [ createNullReporter() ],
            profiles: {
                bench: {
                    testFamily: 'benchmark',
                    baselines: { directory: relative(process.cwd(), directory), adapters: [] },
                    files: { include: [ fixture ] },
                    execution: boundary === 'supervised-process'
                        ? { processModel: 'supervised-process' }
                        : { processModel: 'worker-pool', workerLifecycle: boundary }
                }
            }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            profile: 'bench',
            selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: title } }
        })
    };
}
export async function normalizationReferences(command: RunCommand): Promise<CalibrationReferenceStore> {
    const profile = command.config.profiles.bench;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return await createCalibrationReferenceStore({
        projectRoot: process.cwd(),
        directory: profile.baselines.directory,
        maxBytes: profile.attachments.maxArtifactBytes
    });
}
