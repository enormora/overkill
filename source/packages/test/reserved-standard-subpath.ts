export type UnavailableStandardSubpathApi = (...parameters: readonly unknown[]) => never;

export function createUnavailableStandardSubpathApi(subpath: string): UnavailableStandardSubpathApi {
    return function unavailableStandardSubpathApi(): never {
        throw new Error(`The @overkill-dev/test/${subpath} subpath is reserved until its leaf package exists.`);
    };
}
