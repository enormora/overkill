import type { MutantRunOptions } from '@stryker-mutator/api/test-runner';
import { projectFile, type CampaignBaseline } from './mutation-catalog.ts';

function matchingTestIdentities(root: string, campaign: CampaignBaseline, value: string): readonly string[] {
    const exact = campaign.catalog.find(function matchesIdentity(entry) {
        return entry.id === value;
    });
    if (exact !== undefined) {
        return [ exact.id ];
    }
    const file = projectFile(root, value);
    const matches = campaign.catalog.filter(function matchesTestOrFile(entry) {
        return entry.work.case.file === file;
    });
    if (matches.length === 0) {
        throw new Error('Stryker requested an unknown test identity or file.');
    }
    return matches.map(function testIdentity(entry) {
        return entry.id;
    });
}
function mutantSelection(
    root: string,
    campaign: CampaignBaseline,
    filter: readonly string[] | null
): readonly string[] {
    if (filter === null) {
        return campaign.catalog.map(function testIdentity(entry) {
            return entry.id;
        });
    }
    const ids = filter.flatMap(function expandTestOrFile(value) {
        return matchingTestIdentities(root, campaign, value);
    });
    const selected = new Set(ids);
    if (selected.size !== ids.length) {
        throw new Error('Stryker requested a duplicate test identity.');
    }
    if (ids.length === 0) {
        throw new Error('Stryker requested an empty mutant test selection.');
    }
    return ids;
}
function coveredAtLoad(campaign: CampaignBaseline, id: string): boolean {
    return (campaign.coverage.static[id] ?? 0) > 0;
}

type MutantInvocationPlan = {
    readonly mode: MutantRunOptions['mutantActivation'];
    readonly selected: readonly string[];
};
type MutantInvocationInput = {
    readonly root: string;
    readonly campaign: CampaignBaseline;
    readonly input: Readonly<MutantRunOptions>;
    readonly ignoreStatic: boolean;
};

function mutantActivation(options: MutantInvocationInput): MutantInvocationPlan['mode'] {
    const { campaign, input, ignoreStatic } = options;
    return input.mutantActivation === 'static' || !ignoreStatic && coveredAtLoad(campaign, input.activeMutant.id)
        ? 'static'
        : 'runtime';
}

function supportsNarrowing(
    campaign: CampaignBaseline,
    mutantId: string,
    requested: readonly string[]
): boolean {
    const owners = Object.entries(campaign.coverage.perTest).filter(function coversMutant([ , counters ]) {
        return (counters[mutantId] ?? 0) > 0;
    });
    return owners.length > 0 && owners.every(function includesCoveringCase([ id ]) {
        return requested.includes(id);
    });
}

export function planMutantInvocation(options: MutantInvocationInput): MutantInvocationPlan {
    const { root, campaign, input } = options;
    const requested = mutantSelection(root, campaign, input.testFilter ?? null);
    const mode = mutantActivation(options);
    const canNarrow = mode === 'runtime' && campaign.coverageAnalysis === 'perTest' &&
        supportsNarrowing(campaign, input.activeMutant.id, requested);
    return {
        mode,
        selected: canNarrow ? requested : campaign.catalog.map(function testIdentity(entry) {
            return entry.id;
        })
    };
}
