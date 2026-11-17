import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { ESLint } from 'eslint';
import { z } from 'zod/v4';

async function existingPath(file) {
    try {
        await access(file);
        return true;
    } catch (error) {
        if (!z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
            throw error;
        }
        return false;
    }
}

const argumentIndex = 2;
const [ index, total ] = z
    .tuple([ z.coerce.number().int().positive(), z.coerce.number().int().positive() ])
    .refine(function validIndex([ position, count ]) {
        return position <= count;
    }, 'Shard index exceeds shard total.')
    .parse((process.argv[argumentIndex] ?? '1/1').split('/'));
const { stdout } = await promisify(execFile)('git', [ 'ls-files', '--cached', '-z' ]);
const eslint = new ESLint({
    cache: true,
    cacheLocation: `target/.eslintcache-${index}-of-${total}`,
    cacheStrategy: 'content',
    stats: true
});
const candidates = stdout.split('\0').filter(function existingFile(file) {
    return file.length > 0;
});
const configured = await Promise.all(candidates.map(async function configuredFile(file) {
    const exists = await existingPath(file);
    return { file, ignored: !exists || await eslint.isPathIgnored(file) };
}));
const files = configured
    .filter(function eligibleFile(value) {
        return !value.ignored;
    })
    .map(function configuredPath(value) {
        return value.file;
    })
    .toSorted(function alphabetical(left, right) {
        return left.localeCompare(right, 'en');
    })
    .filter(function assignedFile(_file, position) {
        return position % total === index - 1;
    });
if (files.length === 0) {
    throw new Error('ESLint shard has no files.');
}
process.stdout.write(`ESLint shard ${index}/${total}: ${files.length} files\n`);
const results = await eslint.lintFiles(files);
const formatter = await eslint.loadFormatter('stylish');
process.stdout.write(await formatter.format(results));
process.exitCode = Number(results.some(function failed(result) {
    return result.errorCount > 0 || result.warningCount > 0;
}));
