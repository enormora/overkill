import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Synchronous hooks are supported on the pinned Node version.
import { registerHooks } from 'node:module';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import { invalidRequest } from './run-errors.ts';
import type { FileModuleBoundary } from './run-types.ts';

export const fileModuleBoundarySchema: z.ZodType<FileModuleBoundary> = z
    .strictObject({
        projectRoot: z.string().min(1),
        sharedRoots: z.array(z.string().min(1)).readonly()
    })
    .readonly();

const activeModuleRoots = new AsyncLocalStorage<readonly string[]>();

function containsPath(root: string, path: string): boolean {
    const origin = relative(root, path);
    return origin !== '..' && !origin.startsWith(`..${sep}`) && !isAbsolute(origin);
}

export function validateFileModuleBoundary(boundary: FileModuleBoundary): void {
    if (![ boundary.projectRoot, ...boundary.sharedRoots ].every(isAbsolute)) {
        invalidRequest('Module boundary requires absolute roots.');
    }
    if (
        boundary.sharedRoots.some(function containsProject(root) {
            return containsPath(root, boundary.projectRoot);
        })
    ) {
        invalidRequest('Shared module roots must not contain the project root.');
    }
}

export async function withFileModuleBoundary<Result>(
    boundary: FileModuleBoundary | null,
    operation: () => Promise<Result>
): Promise<Result> {
    if (boundary === null) {
        return await operation();
    }
    validateFileModuleBoundary(boundary);
    const [ projectRoot, sharedRoots ] = await Promise.all([
        realpath(boundary.projectRoot),
        Promise.all(boundary.sharedRoots.map(async function canonicalRoot(root) {
            return realpath(root);
        }))
    ]);
    validateFileModuleBoundary({ projectRoot, sharedRoots });

    return await activeModuleRoots.run([ projectRoot, ...sharedRoots ], async function runBoundedOperation() {
        function validateModule(url: string): void {
            const currentRoots = activeModuleRoots.getStore();
            if (currentRoots === undefined || !url.startsWith('file:')) {
                return;
            }
            // eslint-disable-next-line node/no-sync -- Native synchronous hooks must reject symlink escapes before evaluation.
            const path = realpathSync(fileURLToPath(url));
            if (
                currentRoots.every(function containsModule(root) {
                    return !containsPath(root, path);
                })
            ) {
                invalidRequest(`Module import escapes its boundary: ${path}`);
            }
        }

        const hooks = registerHooks({
            resolve(specifier, context, nextResolve) {
                const resolved = nextResolve(specifier, context);
                validateModule(resolved.url);
                return resolved;
            },
            load(url, context, nextLoad) {
                validateModule(url);
                return nextLoad(url, context);
            }
        });
        try {
            return await operation();
        } finally {
            hooks.deregister();
        }
    });
}
