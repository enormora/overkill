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
export function mutantSelection(
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
function identifiesSandboxFile(root: string, campaign: CampaignBaseline, value: string): boolean {
    if (
        campaign.catalog.some(function matchesIdentity(entry) {
            return entry.id === value;
        })
    ) {
        return false;
    }
    const file = projectFile(root, value);
    return campaign.catalog.some(function matchesCatalogFile(entry) {
        return entry.work.case.file === file;
    });
}
function includesSandboxFile(root: string, campaign: CampaignBaseline, filter: readonly string[] | null): boolean {
    return filter?.some(function isSandboxFile(value) {
        return identifiesSandboxFile(root, campaign, value);
    }) === true;
}
function coveredAtLoad(campaign: CampaignBaseline, id: string): boolean {
    return (campaign.coverage.static[id] ?? 0) > 0;
}

export function mutantActivation(
    input: Readonly<MutantRunOptions>,
    root: string,
    campaign: CampaignBaseline,
    ignoreStatic: boolean
): 'runtime' | 'static' {
    if (input.mutantActivation === 'static') {
        return 'static';
    }
    if (ignoreStatic || !coveredAtLoad(campaign, input.activeMutant.id)) {
        return 'runtime';
    }
    return includesSandboxFile(root, campaign, input.testFilter ?? null) ? 'static' : 'runtime';
}
