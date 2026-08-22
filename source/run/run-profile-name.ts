const runProfileNamePattern = /^[A-Za-z0-9._-]+$/u;
const reservedBenchmarkProfileName = 'benchmark';

export function invalidRunProfileNameMessage(profileName: string): string | null {
    if (!runProfileNamePattern.test(profileName)) {
        return `Invalid profile name "${profileName}". ` +
            'Profile names may only contain letters, numbers, dots, underscores, and hyphens.';
    }

    if (profileName === reservedBenchmarkProfileName) {
        return 'Invalid profile name "benchmark". The "benchmark" profile name is reserved for benchmark commands.';
    }

    return null;
}
