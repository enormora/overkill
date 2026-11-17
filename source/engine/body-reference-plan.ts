import { serializeValue } from '../compare/serialized-value.ts';
import { snapshotPortableValue } from '../portable-value.ts';
import {
    withImplementationActivations,
    type ImplementationActivation,
    type ImplementationParticipant
} from '../implementation-participant.ts';
import { restoreImplementationBuild } from '../implementation-build-preparation.ts';
import {
    implementationCatalogSchema,
    implementationBuildIdentity,
    selectedImplementationAssignments,
    assertImplementationAssignments,
    type ImplementationBuild,
    type ImplementationDeclaration,
    combineImplementationBuilds,
    type ImplementationCatalog,
    type ImplementationAdmission,
    type ImplementationPlanState
} from '../implementation-catalog.ts';
import {
    createImplementationPreparationSession,
    type ImplementationPreparationSession,
    assignmentFacts,
    prepareImplementationAssignments,
    withImplementationAdmission,
    type ImplementationAssignmentRequest
} from '../implementation-assignment.ts';
import type { ImplementationInputContext } from '../implementation-reference.ts';
import { caseParticipants, type RecordExecution } from './body-reference-participants.ts';
import type { TestPlan, TestPlanCase, TestPlanCaseExecution } from './test-plan.ts';
import { workIdentityKey } from './identity.ts';

const planStates = new WeakMap<WeakKey, ImplementationPlanState>();
export function setImplementationPlan<Value extends Record<string, unknown>>(
    value: Value,
    state: ImplementationPlanState
): Value {
    planStates.set(value, state);
    return value;
}
const implementationPlanKey = Symbol.for('@overkill-dev/ImplementationPlan');
type PlannedImplementations = { readonly [implementationPlanKey]: ImplementationPlanState; };
function hasImplementationPlan(value: unknown): value is PlannedImplementations {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, implementationPlanKey);
}
export function implementationPlan(value: unknown): ImplementationPlanState | null {
    if (typeof value === 'object' && value !== null) {
        const state = planStates.get(value);
        if (state !== undefined) {
            return state;
        }
    }
    return hasImplementationPlan(value) ? value[implementationPlanKey] : null;
}
export function withImplementationPlan<Value extends Readonly<Record<string, unknown>>>(
    value: Value,
    state: ImplementationPlanState
): Value {
    return { ...value, [implementationPlanKey]: state };
}

const declarationsKey = Symbol.for('@overkill-dev/ImplementationDeclarations');
type DeclaredPlan = { readonly [declarationsKey]: ReadonlyMap<string, ImplementationDeclaration>; };
function hasDeclarations(plan: TestPlan): plan is DeclaredPlan & TestPlan {
    return Object.hasOwn(plan, declarationsKey);
}
export function implementationDeclarations(plan: TestPlan): ReadonlyMap<string, ImplementationDeclaration> {
    return hasDeclarations(plan) ? plan[declarationsKey] : new Map();
}
function declaredParticipants(testCase: TestPlanCase): ImplementationAssignmentRequest['participants'] {
    return caseParticipants(testCase, function discard() {
        return undefined;
    });
}
async function declareCase(
    request: ImplementationAssignmentRequest,
    preparation: ImplementationPreparationSession
): Promise<ImplementationDeclaration> {
    try {
        return { kind: 'prepared', build: implementationBuildIdentity(await preparation.prepare(request)) };
    } catch (error: unknown) {
        request.signal.throwIfAborted();
        return {
            kind: 'invalid',
            failure: {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error
                    ? error.message
                    : String(error),
                detail: snapshotPortableValue(serializeValue(error))
            }
        };
    }
}
type CaseImplementations = { readonly key: string; readonly participants: readonly ImplementationParticipant[]; };
function referencedCases(plan: TestPlan): readonly CaseImplementations[] {
    return plan
        .cases
        .map(function participants(testCase) {
            return { key: workIdentityKey(testCase.workId), participants: declaredParticipants(testCase) };
        })
        .filter(function referenced(testCase) {
            return testCase.participants.length > 0;
        });
}
async function caseDeclarations(
    cases: readonly CaseImplementations[],
    context: ImplementationInputContext,
    signal: AbortSignal,
    preparation: ImplementationPreparationSession
): Promise<ReadonlyMap<string, ImplementationDeclaration>> {
    const declarations = new Map<string, ImplementationDeclaration>();
    for (const testCase of cases) {
        signal.throwIfAborted();
        declarations.set(
            testCase.key,
            await declareCase({ participants: testCase.participants, context, signal }, preparation)
        );
    }
    return declarations;
}
export async function declareImplementationPlan(
    plan: TestPlan,
    context: ImplementationInputContext,
    signal: AbortSignal,
    createPreparation: () => Promise<ImplementationPreparationSession>
): Promise<TestPlan> {
    if (hasDeclarations(plan)) {
        return plan;
    }
    const cases = referencedCases(plan);
    if (cases.length === 0) {
        return plan;
    }
    const declared = {
        ...plan,
        [declarationsKey]: await caseDeclarations(cases, context, signal, await createPreparation())
    };
    return declared;
}
export function catalogFromDeclarations(
    declarations: readonly (ImplementationDeclaration | null)[],
    projectRoot: string
): ImplementationCatalog | null {
    const builds = declarations.flatMap(function prepared(declaration) {
        if (declaration === null) {
            return [];
        }
        if (declaration.kind === 'invalid') {
            throw new TypeError(declaration.failure.message, { cause: declaration.failure.detail });
        }
        return [ declaration.build ];
    });
    return builds.length === 0
        ? null
        : implementationCatalogSchema.parse({ projectRoot, builds: [ combineImplementationBuilds(builds) ] });
}

function planParticipants(plan: TestPlan, record: RecordExecution): readonly ImplementationParticipant[] {
    return plan.cases.flatMap(function participants(testCase) {
        return caseParticipants(testCase, record);
    });
}
function workKeys(plan: TestPlan): readonly string[] {
    return plan.cases.map(function key(testCase) {
        return workIdentityKey(testCase.workId);
    });
}
function assertPlanAssignments(
    plan: TestPlan,
    catalog: ImplementationCatalog,
    request: ImplementationAssignmentRequest
): void {
    if (catalog.projectRoot !== request.context.projectRoot) {
        throw new TypeError('Implementation project root changed.');
    }
    assertImplementationAssignments(
        selectedImplementationAssignments(catalog, workKeys(plan)),
        assignmentFacts(request)
    );
}
function requireCatalog(
    state: ImplementationPlanState | null,
    participants: readonly ImplementationParticipant[]
): ImplementationCatalog | null {
    if (state === null) {
        if (participants.length > 0) {
            throw new TypeError('Referenced implementations require explicit family preparation and collection.');
        }
        return null;
    }
    if (state.catalog === null && participants.length > 0) {
        throw new TypeError('Frozen execution has no implementation provenance; prepare a new run.');
    }
    return state.catalog;
}
async function preparePlanCatalog(
    plan: TestPlan,
    request: ImplementationAssignmentRequest
): Promise<ImplementationCatalog | null> {
    const declarations = implementationDeclarations(plan);
    if (declarations.size > 0) {
        return catalogFromDeclarations(
            workKeys(plan).map(function declaration(key) {
                return declarations.get(key) ?? null;
            }),
            request.context.projectRoot
        );
    }
    return {
        projectRoot: request.context.projectRoot,
        builds: [ implementationBuildIdentity(await prepareImplementationAssignments(request)) ]
    };
}
function discardExecution(): void {
    return undefined;
}
function validatedFrozenPlan(
    plan: TestPlan,
    state: ImplementationPlanState,
    request: ImplementationAssignmentRequest
): TestPlan {
    const catalog = requireCatalog(state, request.participants);
    if (catalog !== null) {
        assertPlanAssignments(plan, catalog, request);
    }
    return plan;
}
export async function prepareBodyReferences(
    plan: TestPlan,
    context: ImplementationInputContext,
    signal: AbortSignal
): Promise<TestPlan> {
    const request = { participants: planParticipants(plan, discardExecution), context, signal };
    const state = implementationPlan(plan);
    if (state !== null) {
        return validatedFrozenPlan(plan, state, request);
    }
    if (request.participants.length === 0) {
        return plan;
    }
    const catalog = await preparePlanCatalog(plan, request);
    if (catalog !== null) {
        assertPlanAssignments(plan, catalog, request);
    }
    return withImplementationPlan(plan, { admission: 'all', catalog });
}
function explicitlyAdmitted(
    participant: ImplementationParticipant,
    admission: Extract<ImplementationAdmission, Readonly<Record<string, unknown>>>
): boolean {
    if (participant.role === 'resource-owner') {
        return admission.ownerKeys.includes(participant.key);
    }
    return participant.role !== 'body' || admission.body;
}
function admittedParticipant(participant: ImplementationParticipant, admission: ImplementationAdmission): boolean {
    if (typeof admission === 'object') {
        return explicitlyAdmitted(participant, admission);
    }
    if (admission === 'all') {
        return true;
    }
    return participant.scope !== 'per-run' || participant.role !== 'resource-owner';
}
function bindBodies(plan: TestPlan, executions: ReadonlyMap<string, TestPlanCaseExecution>): TestPlan {
    function bind(testCase: TestPlanCase): TestPlanCase {
        return { ...testCase, execution: executions.get(workIdentityKey(testCase.workId)) ?? testCase.execution };
    }
    const [ first, ...remaining ] = plan.cases;
    return { ...plan, cases: [ bind(first), ...remaining.map(bind) ] };
}
function singlePreparedBuild(builds: readonly ImplementationBuild[]): ImplementationBuild {
    const [ build ] = builds;
    if (build === undefined || builds.length !== 1) {
        throw new TypeError('Execution requires one original implementation build.');
    }
    return build;
}
export type BodyPlanAdmissionRuntime = {
    readonly restore: typeof restoreImplementationBuild;
    readonly admit: typeof withImplementationAdmission;
};
type PlanAdmissionInput = {
    readonly plan: TestPlan;
    readonly state: ImplementationPlanState;
    readonly catalog: ImplementationCatalog;
    readonly request: ImplementationAssignmentRequest;
};
async function planAdmissionRequest(
    input: PlanAdmissionInput,
    restore: BodyPlanAdmissionRuntime['restore']
): Promise<
    ImplementationAssignmentRequest & { readonly prepared: Awaited<ReturnType<typeof restoreImplementationBuild>>; }
> {
    const { plan, state, catalog, request } = input;
    assertPlanAssignments(plan, catalog, request);
    return {
        participants: request.participants.filter(function assigned(participant) {
            return admittedParticipant(participant, state.admission);
        }),
        context: { projectRoot: catalog.projectRoot },
        prepared: await restore(singlePreparedBuild(catalog.builds), request.signal),
        signal: request.signal
    };
}
export async function admitBodyPlan<Value>(
    plan: TestPlan,
    signal: Readonly<AbortSignal> | null,
    execute: (resolved: TestPlan, activations: readonly ImplementationActivation[]) => Promise<Value>,
    runtime: BodyPlanAdmissionRuntime
): Promise<Value> {
    const executions = new Map<string, TestPlanCaseExecution>();
    const participants = planParticipants(plan, function record(key, execution) {
        executions.set(key, execution);
    });
    const state = implementationPlan(plan);
    const catalog = requireCatalog(state, participants);
    if (catalog === null || state === null) {
        return await execute(plan, []);
    }
    const { signal: defaultSignal } = new AbortController();
    const request = await planAdmissionRequest({
        plan,
        state,
        catalog,
        request: {
            participants,
            context: { projectRoot: catalog.projectRoot },
            signal: signal ?? defaultSignal
        }
    }, runtime.restore);
    return await runtime.admit(request, async function executeBoundPlan(activations) {
        return await execute(bindBodies(plan, executions), activations);
    });
}
export async function withBodyPlanAdmission<Value>(
    plan: TestPlan,
    signal: Readonly<AbortSignal> | null,
    execute: (resolved: TestPlan, activations: readonly ImplementationActivation[]) => Promise<Value>
): Promise<Value> {
    return await admitBodyPlan(plan, signal, execute, {
        restore: restoreImplementationBuild,
        admit: withImplementationAdmission
    });
}

export async function withPreparedBodyPlan<Value>(
    plan: TestPlan,
    signal: Readonly<AbortSignal> | null,
    execute: (resolved: TestPlan) => Promise<Value>
): Promise<Value> {
    return await withBodyPlanAdmission(plan, signal, async function admitted(resolved, activations) {
        return await withImplementationActivations(activations, async function run() {
            return await execute(resolved);
        });
    });
}
export function hasBodyImplementations(plan: TestPlan): boolean {
    return planParticipants(plan, function discard() {
        return undefined;
    })
        .length > 0;
}

export async function declareImplementations(
    plan: TestPlan,
    context: ImplementationInputContext,
    signal: AbortSignal
): Promise<TestPlan> {
    return await declareImplementationPlan(plan, context, signal, createImplementationPreparationSession);
}
