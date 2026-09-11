import {
    captureSourceLocation,
    forwardAssertionSourceLocations,
    type NonEmptyReadonlyArray,
    type ResolvableSourceLocation,
    type SourceLocation,
    type TestBody,
    type TestScope,
    type ThrowingTestBody
} from '../engine/engine.entry-point.ts';

type ParameterizedTestBody<Data> = (
    scope: TestScope,
    data: Data
) => ReturnType<TestBody>;

const activeMacroDefinitionLocations: NonEmptyReadonlyArray<SourceLocation>[] = [];

function captureAuthoringLocation(): SourceLocation {
    return captureSourceLocation()();
}

export function activeMacroSourceLocations(): readonly SourceLocation[] {
    return activeMacroDefinitionLocations.at(-1) ?? [];
}

function sourceLocationsWithTrailingLocation<Location>(
    sourceLocations: readonly Location[],
    location: Location
): NonEmptyReadonlyArray<Location> {
    const firstLocation = sourceLocations[0];

    return firstLocation === undefined
        ? [ location ]
        : [ firstLocation, ...sourceLocations.slice(1), location ];
}

export function runWithForwardedSourceLocations<Result>(
    sourceLocations: readonly ResolvableSourceLocation[],
    body: () => Result
): Result {
    const firstLocation = sourceLocations[0];

    return firstLocation === undefined
        ? body()
        : forwardAssertionSourceLocations([ firstLocation, ...sourceLocations.slice(1) ], body);
}

export function definitionLocationsForAuthoringCall(): NonEmptyReadonlyArray<SourceLocation> {
    return sourceLocationsWithTrailingLocation(
        activeMacroSourceLocations(),
        captureAuthoringLocation()
    );
}

export function assertionBodyForActiveMacro(body: TestBody): TestBody {
    const sourceLocations = activeMacroSourceLocations();

    if (sourceLocations.length === 0) {
        return body;
    }

    return async function runMacroGeneratedTestBody(scope) {
        return await runWithForwardedSourceLocations(sourceLocations, async function runBody() {
            return await body(scope);
        });
    };
}

export function throwingBodyForActiveMacro(body: ThrowingTestBody): ThrowingTestBody {
    const sourceLocations = activeMacroSourceLocations();

    if (sourceLocations.length === 0) {
        return body;
    }

    return async function runMacroGeneratedThrowingTestBody(scope) {
        await runWithForwardedSourceLocations(sourceLocations, async function runBody() {
            await body(scope);
        });
    };
}

export function runMacroWithDefinitionLocations<Result>(body: () => Result): Result {
    const definitionLocations = definitionLocationsForAuthoringCall();

    activeMacroDefinitionLocations.push(definitionLocations);
    try {
        return body();
    } finally {
        activeMacroDefinitionLocations.pop();
    }
}

export function defineParameterizedTestBodyFactory<Data>(
    body: ParameterizedTestBody<Data>
): (data: Data) => TestBody {
    return function createParameterizedTestBody(data) {
        const sourceLocations: NonEmptyReadonlyArray<ResolvableSourceLocation> = [ captureAuthoringLocation() ];

        return async function runParameterizedTestBody(scope) {
            return forwardAssertionSourceLocations(sourceLocations, async function runBody() {
                return body(scope, data);
            });
        };
    };
}
