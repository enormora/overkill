import type { ProjectIntegrationExecution } from './schema.ts';
import { invalidProfileFileSetNameMessage } from './profile-patterns.ts';
import type {
    IntegrationExecution,
    ProfileFiles,
    WorkDistribution,
    WorkGroup
} from './types.ts';

type NormalizedProfileFileSets = {
    readonly sets: NonNullable<ProfileFiles['sets']>;
};

type ProjectGroupWorkDistribution = Extract<
    NonNullable<Extract<ProjectIntegrationExecution, { readonly processModel: 'worker-pool'; }>['workDistribution']>,
    { readonly mode: 'group'; }
>;
type GroupWorkDistribution = Extract<WorkDistribution, { readonly mode: 'group'; }>;
type GroupValidationContext = {
    readonly assignedFileSets: ReadonlyMap<string, string>;
    readonly assignedGroupNames: ReadonlySet<string>;
    readonly profileFileSets: ReadonlySet<string>;
};
type GroupFileSetValidationContext = GroupValidationContext & {
    readonly groupFileSets: ReadonlySet<string>;
};
type GroupFileSetAssignment = readonly [string, string];

function normalizeWorkGroup(group: ProjectGroupWorkDistribution['groups'][number]): WorkGroup {
    return {
        fileSets: [ group.fileSets[0], ...group.fileSets.slice(1) ],
        granularity: group.granularity ?? 'group',
        name: group.name,
        order: group.order ?? 'profile-default',
        scheduling: group.scheduling ?? 'profile-default',
        workerLifecycle: group.workerLifecycle ?? 'profile-default'
    };
}

export function normalizeWorkDistribution(
    execution: ProjectIntegrationExecution | undefined,
    defaultWorkDistribution: WorkDistribution
): WorkDistribution {
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

function hasFileSets(files: ProfileFiles): files is NormalizedProfileFileSets {
    return files.sets !== undefined;
}

function invalidWorkGroupNameMessage(group: WorkGroup): string | null {
    const message = invalidProfileFileSetNameMessage(group.name);

    return message === null ? null : message.replace('file set name', 'work group name');
}

function invalidDuplicateGroupNameMessage(
    group: WorkGroup,
    assignedGroupNames: ReadonlySet<string>
): string | null {
    return assignedGroupNames.has(group.name)
        ? `Invalid work group "${group.name}": group name is already used.`
        : null;
}

function invalidGroupFileSetMessage(
    fileSet: string,
    group: WorkGroup,
    context: GroupFileSetValidationContext
): string | null {
    if (context.groupFileSets.has(fileSet)) {
        return `Invalid work group "${group.name}": file set "${fileSet}" is already assigned to "${group.name}".`;
    }

    if (!context.profileFileSets.has(fileSet)) {
        return `Invalid work group "${group.name}": unknown file set "${fileSet}".`;
    }

    const assignedGroup = context.assignedFileSets.get(fileSet);

    return assignedGroup === undefined
        ? null
        : `Invalid work group "${group.name}": file set "${fileSet}" is already assigned to "${assignedGroup}".`;
}

function invalidGroupIdentityMessage(
    group: WorkGroup,
    context: GroupValidationContext
): string | null {
    const nameMessage = invalidWorkGroupNameMessage(group);

    return nameMessage ?? invalidDuplicateGroupNameMessage(group, context.assignedGroupNames);
}

function invalidGroupMessage(
    group: WorkGroup,
    context: GroupValidationContext
): string | null {
    const groupMessage = invalidGroupIdentityMessage(group, context);

    if (groupMessage !== null) {
        return groupMessage;
    }

    const groupFileSets = new Set<string>();

    for (const fileSet of group.fileSets) {
        const fileSetMessage = invalidGroupFileSetMessage(fileSet, group, { ...context, groupFileSets });

        if (fileSetMessage !== null) {
            return fileSetMessage;
        }

        groupFileSets.add(fileSet);
    }

    return null;
}

function groupValidationContext(
    assignedFileSets: ReadonlyMap<string, string>,
    assignedGroupNames: ReadonlySet<string>,
    profileFileSets: ReadonlySet<string>
): GroupValidationContext {
    return {
        assignedFileSets,
        assignedGroupNames,
        profileFileSets
    };
}

function groupFileSetAssignments(group: WorkGroup): readonly GroupFileSetAssignment[] {
    return group.fileSets.map(function toAssignment(fileSet) {
        return [ fileSet, group.name ];
    });
}

function invalidAssignedGroupsMessage(
    distribution: GroupWorkDistribution,
    profileFileSets: ReadonlySet<string>
): string | null {
    let assignedFileSets: ReadonlyMap<string, string> = new Map();
    let assignedGroupNames: ReadonlySet<string> = new Set();

    for (const group of distribution.groups) {
        const groupMessage = invalidGroupMessage(
            group,
            groupValidationContext(assignedFileSets, assignedGroupNames, profileFileSets)
        );

        if (groupMessage !== null) {
            return groupMessage;
        }

        assignedGroupNames = new Set([ ...assignedGroupNames, group.name ]);
        assignedFileSets = new Map([ ...assignedFileSets, ...groupFileSetAssignments(group) ]);
    }

    return null;
}

function invalidGroupDistributionMessage(
    distribution: WorkDistribution,
    files: ProfileFiles
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
    execution: IntegrationExecution,
    files: ProfileFiles
): string | null {
    return execution.processModel === 'worker-pool'
        ? invalidGroupDistributionMessage(execution.workDistribution, files)
        : null;
}
