import type { EncodedPropertyInput } from '../packages/engine/engine.entry-point.ts';

const capturedRegressions = new WeakMap<() => unknown, EncodedPropertyInput>();
export function retainRegressionCapture(recipe: () => unknown, input: EncodedPropertyInput): void {
    capturedRegressions.set(recipe, input);
}
export function regressionCapture(recipe: (() => unknown) | null): EncodedPropertyInput | null {
    return recipe === null ? null : capturedRegressions.get(recipe) ?? null;
}
