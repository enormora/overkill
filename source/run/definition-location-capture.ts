export type DefinitionLocationCapture = 'disabled' | 'enabled';

const definitionLocationCaptureStackKey = Symbol.for('@overkill-dev/definition-location-capture-stack');

function isDefinitionLocationCapture(value: unknown): value is DefinitionLocationCapture {
    return value === 'disabled' || value === 'enabled';
}

function isDefinitionLocationCaptureStack(value: unknown): value is DefinitionLocationCapture[] {
    return Array.isArray(value) && value.every(isDefinitionLocationCapture);
}

function activeDefinitionLocationCaptures(): DefinitionLocationCapture[] {
    const existingCaptures: unknown = Reflect.get(globalThis, definitionLocationCaptureStackKey);

    if (isDefinitionLocationCaptureStack(existingCaptures)) {
        return existingCaptures;
    }

    const captures: DefinitionLocationCapture[] = [];
    Reflect.set(globalThis, definitionLocationCaptureStackKey, captures);

    return captures;
}

export async function withDefinitionLocationCapture<Result>(
    capture: DefinitionLocationCapture,
    body: () => Promise<Result>
): Promise<Result> {
    const captures = activeDefinitionLocationCaptures();

    captures.push(capture);
    try {
        return await body();
    } finally {
        captures.pop();
    }
}
