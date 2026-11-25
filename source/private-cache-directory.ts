import { lstat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const privateDirectoryMode = 0o700;
const groupAndOtherModeRange = 0o100;

export async function privateCacheDirectory(name: string): Promise<string | null> {
    const user = process.getuid?.();
    if (user === undefined) {
        return null;
    }
    const directory = join(tmpdir(), `${name}-${user}`);
    await mkdir(directory, { mode: privateDirectoryMode, recursive: true });
    const info = await lstat(directory);
    return info.isDirectory() && info.uid === user && info.mode % groupAndOtherModeRange === 0
        ? directory
        : null;
}
