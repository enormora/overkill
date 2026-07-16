export type TestId = {
    readonly file: string | null;
    readonly name: string;
    readonly suite: readonly string[];
};

export type CaseId = TestId & {
    readonly params: string | null;
};

export function createCaseId(suite: readonly string[], name: string, params: string | null): CaseId {
    return {
        file: null,
        name,
        params,
        suite
    };
}

export function caseIdentityKey(caseId: CaseId): string {
    return JSON.stringify([ caseId.file, caseId.suite, caseId.name, caseId.params ]);
}

export function formatCaseId(caseId: CaseId): string {
    const namePath = [ ...caseId.suite, caseId.name ].join(' > ');
    const originPath = caseId.file === null ? namePath : `${caseId.file}: ${namePath}`;

    if (caseId.params === null) {
        return originPath;
    }

    return `${originPath} [${caseId.params}]`;
}
