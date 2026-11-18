export const implementationMap = {
    version: 3,
    names: [],
    sources: [ 'original.ts' ],
    sourcesContent: [ 'export const value = 42;' ],
    mappings: 'AAAA'
};
export function inlineImplementationMap(map: unknown, encoding: 'base64' | 'percent'): string {
    const data = JSON.stringify(map);
    return encoding === 'base64'
        ? `data:application/json;base64,${Buffer.from(data).toString('base64')}`
        : `data:application/json,${encodeURIComponent(data)}`;
}
