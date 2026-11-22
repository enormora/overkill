import type { API } from 'typescript-beta/async';
import type { InstalledCompiler } from './installed-compiler.ts';
import type { ProjectInputObservation } from './frozen-inputs.ts';

export function openCompiler(compiler: InstalledCompiler, cwd: string, observation: ProjectInputObservation): API {
    const timingDirectory = process.env.TS_API_TIMING_DIR;
    delete process.env.TS_API_TIMING_DIR;
    try {
        return new compiler.native.API({ cwd, fs: observation.fs, runExternalCode: false });
    } finally {
        if (timingDirectory !== undefined) {
            process.env.TS_API_TIMING_DIR = timingDirectory;
        }
    }
}
