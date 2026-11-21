const count = Number(Reflect.get(globalThis, 'coldDependencyCount') ?? 0) + 1;
Reflect.set(globalThis, 'coldDependencyCount', count);
export const dependencyCount = count;
