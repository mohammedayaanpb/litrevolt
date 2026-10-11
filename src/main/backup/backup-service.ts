import fs from 'node:fs';
import path from 'node:path';
import type { LitRevoltDatabase } from '../database/database';
import type { StorageManager } from '../settings/storage';

const pad = (value: number) => String(value).padStart(2, '0');
export const localDateKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export class BackupService {
  constructor(
    private readonly database: LitRevoltDatabase,
    private readonly storage: StorageManager,
  ) {}

  async create(): Promise<string> {
    const date = new Date();
    const stamp = `${localDateKey(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    let destination = path.join(this.storage.backupsDirectory, `litrevolt-backup-${stamp}.db`);
    let suffix = 1;
    while (fs.existsSync(destination)) {
      destination = path.join(this.storage.backupsDirectory, `litrevolt-backup-${stamp}-${suffix}.db`);
      suffix += 1;
    }
    await this.database.backup(destination);
    return destination;
  }
}
