await import('../../../run/worker-pool-host.entry-point.ts');
process.emit('unhandledRejection', new Error('host failed'), Promise.resolve());
process.emit('uncaughtException', new Error('second host failed'));
