import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'LitRevolt',
    executableName: 'LitRevolt',
    appBundleId: 'org.litrevolt.app',
    appCategoryType: 'public.app-category.education',
    asar: true,
    icon: './assets/branding/litrevolt-icon',
    // Native packages and PDF.js must remain real runtime dependencies. PDF.js
    // resolves its fake worker relative to its package at runtime in Electron's
    // main process, so bundling only pdf.mjs would orphan pdf.worker.mjs.
    ignore: (file) => {
      if (!file) return false;
      return !(
        file.startsWith('/.vite') ||
        file === '/node_modules' ||
        file.startsWith('/node_modules/@napi-rs') ||
        file.startsWith('/node_modules/better-sqlite3') ||
        file.startsWith('/node_modules/pdfjs-dist')
      );
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'litrevolt',
      setupExe: 'LitRevolt-Setup.exe',
      authors: 'LitRevolt contributors',
      description: 'A three-pass research paper reader',
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerDeb({ options: { name: 'litrevolt', productName: 'LitRevolt' } }),
    new MakerRpm({ options: { name: 'litrevolt', productName: 'LitRevolt' } }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};

export default config;
