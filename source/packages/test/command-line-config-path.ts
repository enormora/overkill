import { multioption, type Type } from 'cmd-ts';

export const configPathType: Type<readonly string[], string | null> = {
    displayName: 'path',
    async from([ configPath, ...remainingPaths ]) {
        if (remainingPaths.length > 0) {
            throw new TypeError('--config may only be provided once.');
        }
        return configPath ?? null;
    }
};
export const configPathArgument = multioption({
    long: 'config',
    type: configPathType,
    defaultValue() {
        return null;
    }
});
