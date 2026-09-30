export async function loadCoverageFixtures(): Promise<void> {
    await Promise.all([
        import('./coverage-source.ts'),
        import('./coverage-types.ts'),
        import('./coverage-unloaded.ts')
    ]);
}
