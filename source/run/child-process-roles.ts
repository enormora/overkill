const childRoleArgumentPrefix = '--overkill-child-role=';

export const supervisedChildRole = 'supervised';
export const workerPoolHostRole = 'worker-pool-host';

export function childRole(childArguments: readonly string[]): string | null {
    const argument = childArguments.find(function isChildRoleArgument(value) {
        return value.startsWith(childRoleArgumentPrefix);
    });

    return argument === undefined ? null : argument.slice(childRoleArgumentPrefix.length);
}

export function childRoleArgument(role: string): string {
    return `${childRoleArgumentPrefix}${role}`;
}
