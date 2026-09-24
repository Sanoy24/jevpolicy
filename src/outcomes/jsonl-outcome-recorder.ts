import { appendFile } from 'node:fs/promises';

import type { DecisionOutcome, DecisionOutcomeRecorder } from './types.js';

export class JsonlOutcomeRecorder implements DecisionOutcomeRecorder {
  readonly path: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (path.trim().length === 0) {
      throw new TypeError('Outcome recorder path must not be empty');
    }
    this.path = path;
  }

  record(outcome: DecisionOutcome): Promise<void> {
    const write = this.pending.then(async () => {
      await appendFile(this.path, `${JSON.stringify(outcome)}\n`, {
        encoding: 'utf8',
        flag: 'a',
      });
    });
    this.pending = write.catch(() => undefined);
    return write;
  }
}
