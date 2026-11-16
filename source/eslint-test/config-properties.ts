import assert from 'node:assert/strict';
import type { TestCase } from '../packages/engine/engine.entry-point.ts';
import { gen, property, type PropertySampleScope } from '../packages/property/property.entry-point.ts';
import type {
    ConfigContract,
    ConfigGeneration,
    ConfigInput,
    ConfigSource,
    ConfigObservation
} from './config-definition.ts';
import { configLayers, generatedProject, inConfigProject, projectPath } from './config-project.ts';
import { configEngine, stableObservation } from './config-execution.ts';
import { checkConfigContract, validConfigSyntax } from './config-contracts.ts';
import { configInputs } from './config-generation.ts';
import { assertConfigOperation } from './config-assertions.ts';
import { trialCandidates, type ConfigSeeds, type ConfigTrial } from './config-seeds.ts';

type ConfigPropertyRequest = {
    readonly generation: ConfigGeneration<string>;
    readonly source: ConfigSource;
    readonly contract: ConfigContract;
};

async function runCandidate(
    request: ConfigPropertyRequest,
    input: ConfigInput,
    signal: AbortSignal
): Promise<ConfigObservation | null> {
    return await inConfigProject(
        generatedProject(request.generation.project, input),
        signal,
        async function check(context) {
            const configs = await configLayers(request.source, context);
            const execution = { context, configs, materialized: true };
            if (await configEngine(execution, 'parse').isPathIgnored(projectPath(context.root, input.filename))) {
                return null;
            }
            if (!await validConfigSyntax(execution, input)) {
                return null;
            }
            return stableObservation(await checkConfigContract(execution, input, request.contract), context.root);
        }
    );
}

async function checkCandidates(
    request: ConfigPropertyRequest,
    candidates: readonly ConfigInput[],
    signal: AbortSignal
): Promise<boolean> {
    for (const input of candidates) {
        const first = await runCandidate(request, input, signal);
        if (first !== null) {
            if (request.contract.kind === 'repeatability') {
                assert.deepEqual(
                    await runCandidate(request, input, signal),
                    first,
                    'Config execution is not repeatable.'
                );
            }
            return true;
        }
    }
    return false;
}

async function checkTrial(
    request: ConfigPropertyRequest,
    seeds: ConfigSeeds,
    trial: ConfigTrial,
    scope: PropertySampleScope<ConfigTrial>
): Promise<void> {
    const outcome = await assertConfigOperation(scope, request.contract.kind, async function check() {
        const candidates = await trialCandidates(trial, seeds, scope.signal);
        return await checkCandidates(request, candidates, scope.signal);
    });
    if (outcome.kind === 'passed' && !outcome.value) {
        scope.inconclusive('No parseable, included candidate was found in the generated batch.');
    }
}

export function configProperty(request: ConfigPropertyRequest, variant: string, seeds: ConfigSeeds): TestCase {
    const { generation, source, contract } = request;
    return property({
        testFamily: 'integration',
        title: `${generation.title}: ${variant}: ${contract.kind}`,
        generator: gen.array(configInputs(generation, source), { minLength: 8, maxLength: 8 }).map(
            function trial(candidates): ConfigTrial {
                return { kind: 'generated', candidates };
            }
        ),
        examples: seeds.sources.map(function seed(value) {
            return function original(): ConfigTrial {
                return { kind: 'fixture', fixture: value.title };
            };
        }),
        async test(trial, scope) {
            scope.failureKey(`${variant}:${contract.kind}`);
            await checkTrial(request, seeds, trial, scope);
            return scope.assert.collect();
        }
    });
}
