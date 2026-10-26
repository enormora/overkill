import { z } from 'zod/v4';
import { executeMutationScript } from './stryker-script.test.ts';
import {
    campaignEvidenceSchema,
    compareMutationCampaigns,
    type CampaignEvidence,
    type MutationCoverageMode
} from './fixtures/mutation-evidence/mutation-accuracy.test.ts';
import type { MutationMode, MutationModuleUrls } from './fixtures/mutation-evidence/mutation-project.test.ts';

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const accuracyUrl = new URL(`./fixtures/mutation-evidence/mutation-accuracy.test.${extension}`, import.meta.url);
const script = `
const { accuracyCampaign } = await import(process.argv[1]);
const [modules, mode, seed, coverage] = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify(await accuracyCampaign(modules, mode, seed, coverage)));
`;

export async function captureMutationCampaign(
    modules: MutationModuleUrls,
    mode: MutationMode,
    seed: string,
    coverage: MutationCoverageMode
): Promise<CampaignEvidence> {
    const output = await executeMutationScript(
        script,
        [ accuracyUrl.href, JSON.stringify([ modules, mode, seed, coverage ]) ],
        process.cwd()
    );
    return campaignEvidenceSchema.parse(z.json().parse(JSON.parse(output)));
}

export async function verifyMutationAccuracy(
    modules: MutationModuleUrls,
    mode: MutationMode,
    seed: string,
    coverageModes: readonly MutationCoverageMode[]
): Promise<readonly CampaignEvidence[]> {
    const evidence: CampaignEvidence[] = [];
    for (const coverage of coverageModes) {
        evidence.push(await captureMutationCampaign(modules, mode, seed, coverage));
    }
    compareMutationCampaigns(evidence);
    return evidence;
}
