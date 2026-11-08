import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { TestScope } from '../packages/test/test.entry-point.ts';
import {
    defineBaselineAdapter,
    normalizeConfig,
    orchestrator,
    type RunCommand,
    type ProjectProfileFiles,
    type OrdinaryBaselineAdapter
} from '../packages/run/run.entry-point.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from '../run/baseline-store.ts';
import type { OrdinaryBaselineEntry } from '../run/baseline-record.ts';
import { defaultRunRequest } from './run-command-factory.ts';

export const ordinaryBaselineFixtureFile = 'source/integration-tests/run/fixtures/ordinary-baselines.test.ts';
type ObservationProposal = { readonly actual: number; };
type ObservationComparison = { readonly actual: number; readonly expected: number; };
type Execution = 'in-process' | 'supervised-process' | 'worker-pool';
type ObservationControl = {
    readonly adapter: OrdinaryBaselineAdapter;
    readonly setActual: (value: number) => void;
    readonly setTolerance: (value: number) => void;
    readonly setMissingObservation: (value: boolean) => void;
    readonly observations: () => number;
};
export type OrdinaryBaselineFixture = ObservationControl & {
    readonly command: RunCommand;
    readonly directory: string;
    readonly entries: () => Promise<readonly OrdinaryBaselineEntry[]>;
    readonly store: () => Promise<OrdinaryBaselineStore>;
};
function createObservationAdapter(payloadKind: 'binary' | 'text'): ObservationControl {
    let actual = 42;
    let tolerance = 0;
    let observations = 0;
    let missing = false;
    const adapter = defineBaselineAdapter({
        subtype: 'content-snapshot',
        comparisonContext: {},
        adapter: {
            id: 'output',
            async observe({ work }) {
                observations += 1;
                return missing && work.case.title === 'second'
                    ? { kind: 'missing', reason: 'Observation unavailable.' }
                    : { kind: 'observed', value: actual };
            },
            async propose(input: ObservationProposal) {
                return input.actual;
            },
            async compare(input: ObservationComparison) {
                return Math.abs(input.actual - input.expected) <= tolerance
                    ? { kind: 'match' }
                    : {
                        kind: 'mismatch',
                        diagnostics: [ { actual: input.actual, expected: input.expected, summary: 'Output changed.' } ]
                    };
            }
        },
        toComparisonValue(value: number) {
            return value;
        },
        async encode(value: number) {
            return payloadKind === 'text'
                ? { kind: 'text', text: String(value) }
                : { kind: 'binary', bytes: new Uint8Array([ value ]) };
        },
        async decode(payload) {
            if (payload.kind === 'text') {
                return Number(payload.text);
            }
            const [ value ] = payload.bytes;
            if (value === undefined) {
                throw new Error('Empty binary baseline.');
            }
            return value;
        }
    });
    return {
        adapter,
        setTolerance(value) {
            tolerance = value;
        },
        setActual(value) {
            actual = value;
        },
        setMissingObservation(value) {
            missing = value;
        },
        observations() {
            return observations;
        }
    };
}
export async function createOrdinaryBaselineFixture(
    scope: TestScope,
    execution: Execution,
    payloadKind: 'binary' | 'text'
): Promise<OrdinaryBaselineFixture> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/ordinary-baselines-');
    scope.cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    const control = createObservationAdapter(payloadKind);
    const baselines = { directory, adapters: [ control.adapter ] };
    const files: ProjectProfileFiles = { include: [ ordinaryBaselineFixtureFile ] };
    const config = normalizeConfig({
        runtimeStateDir: `${directory}/runtime`,
        profiles: {
            unit: execution === 'worker-pool'
                ? {
                    testFamily: 'integration',
                    files,
                    baselines,
                    timeouts: { collectionMilliseconds: 30_000 },
                    execution: { processModel: 'worker-pool', maxWorkers: 2 }
                }
                : {
                    testFamily: 'microtest',
                    files,
                    baselines,
                    timeouts: { collectionMilliseconds: 30_000 },
                    execution: { processModel: execution }
                }
        }
    });
    const command: RunCommand = {
        config: { ...config, reporters: [] },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'unit' })
    };
    return {
        ...control,
        command,
        directory,
        async entries() {
            return await orchestrator.baseline.list({ ...command, request: { paths: [], profile: 'unit' } });
        },
        async store() {
            return await createOrdinaryBaselineStore({ directory, projectRoot: process.cwd(), maxBytes: 1_048_576 });
        }
    };
}
