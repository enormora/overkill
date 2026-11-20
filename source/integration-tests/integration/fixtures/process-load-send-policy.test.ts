process.send?.({ userMessage: 'unexpected during load' });
await new Promise(() => {});
