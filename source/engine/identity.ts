export type TestId = {
    readonly file: string | null;
    readonly suite: readonly string[];
    readonly title: string;
};

export type CaseId = TestId & {
    readonly params: string | null;
};

export function createCaseId(
    file: string | null,
    suite: readonly string[],
    title: string,
    params: string | null
): CaseId {
    return {
        file,
        params,
        suite,
        title
    };
}

export function caseIdentityKey(caseId: CaseId): string {
    return JSON.stringify([ caseId.file, caseId.suite, caseId.title, caseId.params ]);
}

export function formatCaseId(caseId: CaseId): string {
    const titlePath = [ ...caseId.suite, caseId.title ].join(' > ');
    const originPath = caseId.file === null ? titlePath : `${caseId.file}: ${titlePath}`;

    if (caseId.params === null) {
        return originPath;
    }

    return `${originPath} [${caseId.params}]`;
}
