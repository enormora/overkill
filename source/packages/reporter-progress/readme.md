# `@overkill-dev/reporter-progress`

TTY progress reporter with final tree output for Overkill test runs.

```ts
import { createProgressReporter } from '@overkill-dev/reporter-progress';
```

The reporter declares `stdout-raw`. It shows compact real-time progress and
prints the logical result tree, detailed problems, and final counts with timing
when the run finishes.
