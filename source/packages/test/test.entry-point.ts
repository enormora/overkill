type UnavailableAuthoringApi = (...parameters: readonly unknown[]) => never;

function createUnavailableAuthoringApi(name: string): UnavailableAuthoringApi {
    return function unavailableAuthoringApi(): never {
        throw new Error(`The @overkill-dev/test ${name}() authoring API is not implemented yet.`);
    };
}

export const createTestFacade = createUnavailableAuthoringApi('createTestFacade');
export const defineMacro = createUnavailableAuthoringApi('defineMacro');
export const runIfMain = createUnavailableAuthoringApi('runIfMain');
export const suite = createUnavailableAuthoringApi('suite');
export const table = createUnavailableAuthoringApi('table');
export const test = createUnavailableAuthoringApi('test');

export type {
    Metadata,
    RunIfMainOptions,
    RunIfMainRootOptions,
    Suite,
    Table,
    TestBody,
    TestCase,
    TestNode,
    TestScope,
    TestScopeAssertContext
} from '../engine/engine.entry-point.ts';
