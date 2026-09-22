import { appendFile } from 'node:fs/promises';

import type { DecisionRecord, DecisionRecorder } from './types.js';

export class JsonlRecorder implements DecisionRecorder {
  readonly path: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (path.trim().length === 0) {
      throw new TypeError('Recorder path must not be empty');
    }
    this.path = path;
  }

  record(record: DecisionRecord): Promise<void> {
    const write = this.pending.then(async () => {
      await appendFile(this.path, `${JSON.stringify(record)}\n`, {
        encoding: 'utf8',
        flag: 'a',
      });
    });
    this.pending = write.catch(() => undefined);
    return write;
  }
}
