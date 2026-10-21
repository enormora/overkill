import { dependencyCount } from './cold-dependency.test.ts';

process.stdout.write(JSON.stringify({ pid: process.pid, dependencyCount }));
