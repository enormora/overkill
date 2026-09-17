export type TestId = {
    readonly file: string | null;
    readonly suite: readonly string[];
    readonly title: string;
};

export type CaseId = TestId & {
    readonly params: string | null;
};

export type RuntimeDimensions = Readonly<Record<string, string>>;

export type RuntimeId = {
    readonly dimensions: RuntimeDimensions;
    readonly name: string;
    readonly variantId: string | null;
};

export type WorkloadId = {
    readonly name: string;
    readonly params: Readonly<Record<string, string>>;
};

export type WorkId = {
    readonly case: CaseId;
    readonly runtimes: readonly RuntimeId[];
    readonly workload: WorkloadId | null;
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

function orderedRecordEntries(record: Readonly<Record<string, string>>): readonly [string, string][] {
    return Object.entries(record).toSorted(function compareKeys([ left ], [ right ]) {
        return left.localeCompare(right);
    });
}

function runtimeIdentityShape(runtime: RuntimeId): unknown {
    return [
        runtime.name,
        runtime.variantId,
        orderedRecordEntries(runtime.dimensions)
    ];
}

function runtimeIdentitiesShape(runtimes: readonly RuntimeId[]): unknown {
    return runtimes.map(runtimeIdentityShape);
}

function workloadIdentityShape(workload: WorkloadId | null): unknown {
    if (workload === null) {
        return null;
    }

    return [
        workload.name,
        orderedRecordEntries(workload.params)
    ];
}

export function runtimeIdentityKey(runtime: RuntimeId): string {
    return JSON.stringify(runtimeIdentityShape(runtime));
}

export function runtimeIdentitiesKey(runtimes: readonly RuntimeId[]): string {
    return JSON.stringify(runtimeIdentitiesShape(runtimes));
}

export function workIdentityKey(work: WorkId): string {
    if (work.runtimes.length === 0 && work.workload === null) {
        return caseIdentityKey(work.case);
    }

    return JSON.stringify([
        caseIdentityKey(work.case),
        runtimeIdentitiesShape(work.runtimes),
        workloadIdentityShape(work.workload)
    ]);
}

export function createDefaultWorkId(testCase: CaseId): WorkId {
    return {
        case: testCase,
        runtimes: [],
        workload: null
    };
}

export function formatCaseId(caseId: CaseId): string {
    const titlePath = [ ...caseId.suite, caseId.title ].join(' > ');
    const originPath = caseId.file === null ? titlePath : `${caseId.file}: ${titlePath}`;

    if (caseId.params === null) {
        return originPath;
    }

    return `${originPath} [${caseId.params}]`;
}
