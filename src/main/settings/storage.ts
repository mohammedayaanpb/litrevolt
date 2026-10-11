import fs from 'node:fs';
import path from 'node:path';

interface LocationPointer {
  version: 1;
  dataDirectory: string;
}

export class StorageManager {
  private readonly pointerPath: string;
  private dataDirectory: string | null = null;

  constructor(private readonly bootstrapDirectory: string) {
    this.pointerPath = path.join(bootstrapDirectory, 'litrevolt-location.json');
  }

  load(): string | null {
    if (!fs.existsSync(this.pointerPath)) return null;
    let pointer: LocationPointer;
    try {
      pointer = JSON.parse(fs.readFileSync(this.pointerPath, 'utf8')) as LocationPointer;
    } catch {
      throw new Error('LitRevolt could not read its saved data-folder location. Restore or remove litrevolt-location.json, then restart LitRevolt.');
    }
    if (!pointer.dataDirectory || !path.isAbsolute(pointer.dataDirectory)) {
      throw new Error('LitRevolt’s saved data-folder location is invalid. Restore or remove litrevolt-location.json, then restart LitRevolt.');
    }
    if (!fs.existsSync(pointer.dataDirectory)) {
      throw new Error('LitRevolt’s configured data folder is unavailable. Reconnect the drive or restore the folder, then restart LitRevolt.');
    }
    this.dataDirectory = pointer.dataDirectory;
    this.ensureDataDirectories();
    return this.dataDirectory;
  }

  initialize(dataDirectory: string): void {
    const resolved = path.resolve(dataDirectory);
    fs.mkdirSync(resolved, { recursive: true });
    const previousDirectory = this.dataDirectory;
    this.dataDirectory = resolved;
    const temporaryPointerPath = `${this.pointerPath}.${process.pid}.tmp`;
    try {
      this.ensureDataDirectories();
      fs.mkdirSync(this.bootstrapDirectory, { recursive: true });
      const pointer: LocationPointer = { version: 1, dataDirectory: resolved };
      fs.writeFileSync(temporaryPointerPath, JSON.stringify(pointer, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPointerPath, this.pointerPath);
    } catch (error) {
      this.dataDirectory = previousDirectory;
      throw error;
    } finally {
      fs.rmSync(temporaryPointerPath, { force: true });
    }
  }

  private ensureDataDirectories(): void {
    for (const folder of ['config', 'papers', 'backups', 'temp']) {
      fs.mkdirSync(path.join(this.root, folder), { recursive: true });
    }
  }

  get isConfigured(): boolean {
    return this.dataDirectory !== null;
  }

  get root(): string {
    if (!this.dataDirectory) throw new Error('LitRevolt data directory has not been configured.');
    return this.dataDirectory;
  }

  get databasePath(): string {
    return path.join(this.root, 'litrevolt.db');
  }

  get papersDirectory(): string {
    return path.join(this.root, 'papers');
  }

  get backupsDirectory(): string {
    return path.join(this.root, 'backups');
  }

  get tempDirectory(): string {
    return path.join(this.root, 'temp');
  }

  get configPath(): string {
    return path.join(this.root, 'config', 'litrevolt-config.enc');
  }
}
