import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageManager } from '../src/main/settings/storage';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('local storage layout', () => {
  it('recreates required managed directories when loading an existing location', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-storage-'));
    roots.push(root);
    const bootstrap = path.join(root, 'bootstrap');
    const data = path.join(root, 'data');
    new StorageManager(bootstrap).initialize(data);
    fs.rmSync(path.join(data, 'papers'), { recursive: true, force: true });

    const reloaded = new StorageManager(bootstrap);
    expect(reloaded.load()).toBe(path.resolve(data));
    for (const folder of ['config', 'papers', 'backups', 'temp']) {
      expect(fs.statSync(path.join(data, folder)).isDirectory()).toBe(true);
    }
  });

  it('does not reinterpret an unavailable configured folder as first launch', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-storage-'));
    roots.push(root);
    const bootstrap = path.join(root, 'bootstrap');
    const data = path.join(root, 'data');
    new StorageManager(bootstrap).initialize(data);
    fs.rmSync(data, { recursive: true, force: true });
    expect(() => new StorageManager(bootstrap).load()).toThrow(/configured data folder is unavailable/i);
  });
});
