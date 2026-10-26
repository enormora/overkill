import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    availableMetric, benchmark, defaultSamplingPolicy, processMeasurement, rawMeasurement, suite,
    unavailableMetric, workload, type BenchmarkMeasureContext, type BenchmarkMetrics, type ProcessSample, type WorkloadParameters
} from '../../../../packages/bench/bench.entry-point.ts';
import { defineResource, withResource } from '../../../../packages/test/resources.entry-point.ts';
import {
    mutationCostEvidenceSchema, mutationCostParametersSchema,
    writeCostLifecycle,
    type MutationCostEvidence, type MutationCostParameters
} from './mutation-cost-evidence.test.ts';
import { mutationModes, sourceMutationModules, writeCostProject, type MutationMode } from './mutation-project.test.ts';

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const driverModule = new URL(`./mutation-cost-evidence.test.${extension}`, import.meta.url).href;
const driver = `
const { measureMutationCosts } = await import(process.argv[1]);
const [modules, parameters] = JSON.parse(process.argv[2]);
process.stdout.write('MUTATION_COST_READY\\n');
process.stdout.write(JSON.stringify(await measureMutationCosts(modules, parameters)));
`;
const project = defineResource({
    name: 'mutation-cost-project', scope: 'per-case', requirements: [],
    workload(parameters: WorkloadParameters) { return mutationCostParametersSchema.parse(parameters); },
    async acquire(context): Promise<{ readonly cwd: string; }> {
        const parameters = mutationCostParametersSchema.parse(context.workload?.parameters);
        const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-mutation-cost-')));
        try {
            await writeCostProject(sourceMutationModules, parameters, parameters.files, parameters.casesPerFile, cwd);
            if (parameters.tier === 'execution-session') await writeCostLifecycle(sourceMutationModules, cwd);
            return { cwd };
        } catch (error: unknown) {
            await rm(cwd, { recursive: true, force: true });
            throw error;
        }
    },
    async dispose(handle) { await rm(handle.cwd, { recursive: true, force: true }); }
});

const commonMetrics = [ 'durationMicroseconds', 'driverStartupMilliseconds' ];
const sessionMetrics = [
    'initialPlanReadyMicroseconds', 'subsequentPlanReadyMicroseconds',
    'initialExecutionMicroseconds', 'subsequentExecutionMicroseconds',
    'initialInvocationMicroseconds', 'subsequentInvocationMicroseconds',
    'freshHostEntryToLifecycleMicroseconds', 'disposalMicroseconds'
];
function microseconds(value: number) {
    return availableMetric(value, { collector: 'mutation-validation-v1', scope: 'process', unit: 'microseconds' });
}
function phaseMetrics(evidence: MutationCostEvidence): BenchmarkMetrics {
    if (evidence.tier === 'campaign') return { campaignMicroseconds: microseconds(evidence.campaignMicroseconds) };
    const [ initial, ...subsequent ] = evidence.observations;
    if (initial === undefined) throw new Error('Missing initial invocation');
    const mean = (key: 'planReadyMicroseconds' | 'executionMicroseconds' | 'invocationMicroseconds' | 'processEntryToLifecycleMicroseconds') =>
        subsequent.reduce((sum, observation) => sum + observation[key], 0) / subsequent.length;
    return {
        initialPlanReadyMicroseconds: microseconds(initial.planReadyMicroseconds),
        subsequentPlanReadyMicroseconds: microseconds(mean('planReadyMicroseconds')),
        initialExecutionMicroseconds: microseconds(initial.executionMicroseconds),
        subsequentExecutionMicroseconds: microseconds(mean('executionMicroseconds')),
        initialInvocationMicroseconds: microseconds(initial.invocationMicroseconds),
        subsequentInvocationMicroseconds: microseconds(mean('invocationMicroseconds')),
        disposalMicroseconds: microseconds(evidence.disposalMicroseconds),
        freshHostEntryToLifecycleMicroseconds: evidence.environmentLifetime === 'fresh'
            ? microseconds(mean('processEntryToLifecycleMicroseconds'))
            : unavailableMetric('No fresh invocation host was created.', {
                collector: 'mutation-validation-v1', scope: 'process', unit: 'microseconds'
            })
    };
}
type Context = BenchmarkMeasureContext<MutationCostParameters, ProcessSample>;
const measure = withResource<typeof project, Context, BenchmarkMetrics>(project, async function measureCost(context) {
    const parameters = mutationCostParametersSchema.parse(context.workload.parameters);
    const run = await context.sample.process({
        command: [ process.execPath, '--input-type=module', '--eval', driver, driverModule,
            JSON.stringify([ sourceMutationModules, parameters ]) ],
        cwd: context.resources['mutation-cost-project'].cwd, env: null, io: { kind: 'pipes' },
        completion: { kind: 'exit', readiness: { stream: 'stdout', text: 'MUTATION_COST_READY\n' },
            steps: [], expectedExitCodes: [ 0 ] }
    });
    const output = run.value.output;
    if (output.kind !== 'pipes' || output.stdout.truncated || output.stderr.bytes !== 0) {
        throw new Error('Missing, truncated, or failed mutation cost evidence');
    }
    const marker = 'MUTATION_COST_READY\n';
    if (!output.stdout.text.startsWith(marker)) throw new Error('Missing cost driver readiness');
    const evidence = mutationCostEvidenceSchema.parse(JSON.parse(output.stdout.text.slice(marker.length)));
    if (evidence.tier !== parameters.tier) throw new Error('Cost driver returned another measurement tier');
    return {
        completedInvocations: evidence.completedInvocations,
        durationMicroseconds: run.metrics.durationMicroseconds,
        driverStartupMilliseconds: run.metrics.startupMilliseconds,
        ...phaseMetrics(evidence)
    };
});

export function createMutationCostSuite(samples: number, includeLarge: boolean, modes: readonly MutationMode[]) {
    const sizes = includeLarge ? [ { name: 'small', files: 1, casesPerFile: 2 }, { name: 'large', files: 2, casesPerFile: 4 } ]
        : [ { name: 'small', files: 1, casesPerFile: 2 } ];
    const parameters = sizes.flatMap(size => modes.flatMap(mode => [
        ...([ 'perTest', 'off' ] as const).map(coverage => mutationCostParametersSchema.parse({
            ...mode, files: size.files, casesPerFile: size.casesPerFile, tier: 'campaign', coverage, mutants: 1
        })),
        mutationCostParametersSchema.parse({ ...mode, files: size.files, casesPerFile: size.casesPerFile,
            tier: 'execution-session', coverage: 'none' })
    ]));
    const build = extension === 'ts' ? 'source' : 'compiled';
    return suite(`mutation costs: ${build} checkout, raw measurements`, ([ 'campaign', 'execution-session' ] as const).map(tier => {
        const workloads = parameters.filter(parameters => parameters.tier === tier).map(parameters =>
            workload(`${parameters.files}-files-${parameters.casesPerFile}-cases-${parameters.processModel}-${String(parameters.freshState)}-${parameters.coverage}`, parameters)
        );
        const expected = tier === 'campaign' ? 1 : 2;
        return benchmark(tier, {
            kind: 'runtime', workloads,
            measurement: rawMeasurement(processMeasurement({ instrumentation: 'off' })), measure,
            diagnosticMetrics: [ ...commonMetrics, ...(tier === 'campaign' ? [ 'campaignMicroseconds' ] : sessionMetrics) ],
            budgets: Object.fromEntries(workloads.map(workload => [ workload.name, { completedInvocations: [
                { minimum: expected, statistic: { kind: 'observed-minimum' as const } },
                { maximum: expected, statistic: { kind: 'observed-maximum' as const } }
            ] } ]))
        }, {
            annotations: {}, controls: {}, sampling: { ...defaultSamplingPolicy, minimumSamples: samples, maximumSamples: samples },
            lifecycle: { warmupSamples: 0, garbageCollection: 'off', cooldown: { mode: 'off' } }
        });
    }));
}

export const testNode = createMutationCostSuite(5, true, mutationModes);
