import type { RunProjectIntegrationExecution } from './run-config-schema.ts';
import {
    invalidRunProfileFileSetNameMessage,
    type RunIntegrationExecution,
    type RunProfileFiles,
    type RunWorkDistribution,
    type RunWorkGroup
} from './run-types.ts';

type NormalizedProfileFileSets = {
    readonly sets: NonNullable<RunProfileFiles['sets']>;
};

type GroupWorkDistribution = Extract<RunWorkDistribution, { readonly mode: 'group'; }>;

function normalizeWorkGroup(group: RunWorkGroup): RunWorkGroup {
    return {
        fileSets: [ group.fileSets[0], ...group.fileSets.slice(1) ],
        name: group.name
    };
}

export function normalizeWorkDistribution(
    execution: RunProjectIntegrationExecution | undefined,
    defaultWorkDistribution: RunWorkDistribution
): RunWorkDistribution {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkDistribution;
    }

    const workDistribution = execution.workDistribution ?? defaultWorkDistribution;

    if (workDistribution.mode !== 'group') {
        return workDistribution;
    }

    return {
        groups: [
            normalizeWorkGroup(workDistribution.groups[0]),
            ...workDistribution.groups.slice(1).map(normalizeWorkGroup)
        ],
        mode: 'group',
        unmatched: workDistribution.unmatched ?? 'reject'
    };
}

function hasFileSets(files: RunProfileFiles): files is NormalizedProfileFileSets {
    return files.sets !== undefined;
}

function invalidWorkGroupNameMessage(group: RunWorkGroup): string | null {
    const message = invalidRunProfileFileSetNameMessage(group.name);

    return message === null ? null : message.replace('file set name', 'work group name');
}

function invalidGroupFileSetMessage(
    fileSet: string,
    group: RunWorkGroup,
    profileFileSets: ReadonlySet<string>,
    assignedFileSets: ReadonlyMap<string, string>
): string | null {
    if (!profileFileSets.has(fileSet)) {
        return `Invalid work group "${group.name}": unknown file set "${fileSet}".`;
    }

    const assignedGroup = assignedFileSets.get(fileSet);

    return assignedGroup === undefined
        ? null
        : `Invalid work group "${group.name}": file set "${fileSet}" is already assigned to "${assignedGroup}".`;
}

function invalidGroupMessage(
    group: RunWorkGroup,
    profileFileSets: ReadonlySet<string>,
    assignedFileSets: ReadonlyMap<string, string>
): string | null {
    const groupMessage = invalidWorkGroupNameMessage(group);

    if (groupMessage !== null) {
        return groupMessage;
    }

    for (const fileSet of group.fileSets) {
        const fileSetMessage = invalidGroupFileSetMessage(fileSet, group, profileFileSets, assignedFileSets);

        if (fileSetMessage !== null) {
            return fileSetMessage;
        }
    }

    return null;
}

function invalidAssignedGroupsMessage(
    distribution: GroupWorkDistribution,
    profileFileSets: ReadonlySet<string>
): string | null {
    const assignedFileSets = new Map<string, string>();

    for (const group of distribution.groups) {
        const groupMessage = invalidGroupMessage(group, profileFileSets, assignedFileSets);

        if (groupMessage !== null) {
            return groupMessage;
        }

        for (const fileSet of group.fileSets) {
            assignedFileSets.set(fileSet, group.name);
        }
    }

    return null;
}

function invalidGroupDistributionMessage(
    distribution: RunWorkDistribution,
    files: RunProfileFiles
): string | null {
    if (distribution.mode !== 'group') {
        return null;
    }

    if (!hasFileSets(files)) {
        return 'Grouped work distribution requires profile files.sets.';
    }

    return invalidAssignedGroupsMessage(distribution, new Set(Object.keys(files.sets)));
}

export function invalidWorkDistributionConfigMessage(
    execution: RunIntegrationExecution,
    files: RunProfileFiles
): string | null {
    return execution.processModel === 'worker-pool'
        ? invalidGroupDistributionMessage(execution.workDistribution, files)
        : null;
}
