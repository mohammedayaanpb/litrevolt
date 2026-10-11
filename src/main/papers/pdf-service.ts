import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ImportResult } from '../../shared/types';
import type { LitRevoltDatabase } from '../database/database';
import type { StorageManager } from '../settings/storage';

interface ExtractedPdf {
  title: string;
  authors: string;
  year: string;
  abstract: string;
  pageCount: number;
  searchable: boolean;
  extractedText: string;
}

const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

const cleanMetadata = (value: unknown): string => typeof value === 'string'
  ? value.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim()
  : '';

export async function installPdfGeometryGlobals(): Promise<void> {
  if (globalThis.DOMMatrix && globalThis.DOMPoint && globalThis.DOMRect && globalThis.ImageData && globalThis.Path2D) return;
  const canvas = await import('@napi-rs/canvas');
  const geometry = {
    DOMMatrix: canvas.DOMMatrix,
    DOMPoint: canvas.DOMPoint,
    DOMRect: canvas.DOMRect,
    ImageData: canvas.ImageData,
    Path2D: canvas.Path2D,
  };
  for (const [name, implementation] of Object.entries(geometry)) {
    if (!(name in globalThis)) {
      Object.defineProperty(globalThis, name, { value: implementation, configurable: true, writable: true });
    }
  }
}

export class PdfService {
  constructor(
    private readonly database: LitRevoltDatabase,
    private readonly storage: StorageManager,
  ) {}

  async importFile(sourcePath: string, projectId?: string): Promise<ImportResult> {
    const size = fs.statSync(sourcePath).size;
    if (size > MAX_IMPORT_BYTES) throw new Error('The selected PDF is too large to import. Choose a file smaller than 250 MB.');
    const bytes = fs.readFileSync(sourcePath);
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('The selected file is not a valid PDF.');
    const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const existing = this.database.findPaperByHash(fileHash);
    if (existing) {
      const source = this.database.getPaperSource(existing.id);
      const managedPath = this.resolveManagedPath(source.managedPath);
      if (!fs.existsSync(managedPath)) fs.copyFileSync(sourcePath, managedPath, fs.constants.COPYFILE_EXCL);
      if (projectId && !existing.projectIds.includes(projectId)) {
        this.database.setPaperProjects(existing.id, [...existing.projectIds, projectId]);
      }
      return { paper: this.database.getPaper(existing.id), duplicate: true };
    }

    const id = crypto.randomUUID();
    const managedPath = path.join(this.storage.papersDirectory, `${id}.pdf`);
    const extracted = await this.extract(bytes, path.basename(sourcePath, path.extname(sourcePath)));
    fs.copyFileSync(sourcePath, managedPath, fs.constants.COPYFILE_EXCL);
    try {
      const paper = this.database.insertPaper({
        id,
        ...extracted,
        originalName: path.basename(sourcePath),
        managedPath,
        fileHash,
      }, projectId);
      return { paper, duplicate: false };
    } catch (error) {
      fs.rmSync(managedPath, { force: true });
      throw error;
    }
  }

  readPdf(id: string): Uint8Array {
    const paper = this.database.getPaper(id);
    if (paper.activeQuizReviewId) throw new Error('The PDF is hidden until the active closed-book quiz is submitted.');
    const source = this.database.getPaperSource(id);
    return new Uint8Array(fs.readFileSync(this.resolveManagedPath(source.managedPath)));
  }

  deletePaper(id: string): void {
    const managedPath = this.database.getPaperSource(id).managedPath;
    const resolved = this.resolveManagedPath(managedPath);
    const quarantinePath = path.join(this.storage.tempDirectory, `${id}-${crypto.randomUUID()}.pdf.deleting`);
    const moved = fs.existsSync(resolved);
    if (moved) fs.renameSync(resolved, quarantinePath);
    try {
      this.database.deletePaper(id);
    } catch (error) {
      if (moved && fs.existsSync(quarantinePath)) fs.renameSync(quarantinePath, resolved);
      throw error;
    }
    try { fs.rmSync(quarantinePath, { force: true }); }
    catch (error) { console.error('LitRevolt could not remove a quarantined managed PDF:', error); }
  }

  private resolveManagedPath(managedPath: string): string {
    const resolved = path.resolve(managedPath);
    const paperRoot = `${path.resolve(this.storage.papersDirectory)}${path.sep}`;
    const matches = process.platform === 'win32'
      ? resolved.toLocaleLowerCase().startsWith(paperRoot.toLocaleLowerCase())
      : resolved.startsWith(paperRoot);
    if (!matches) throw new Error('Refusing to access a PDF outside LitRevolt managed storage.');
    return resolved;
  }

  private async extract(bytes: Buffer, fallbackTitle: string): Promise<ExtractedPdf> {
    await installPdfGeometryGlobals();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    try {
      const document = await loadingTask.promise;
      const pageCount = document.numPages;
      const metadata = await document.getMetadata().catch(() => null);
      const info = (metadata?.info ?? {}) as Record<string, unknown>;
      const pages: string[] = [];
      const openingLines: string[] = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const parts = content.items
            .filter((item): item is typeof item & { str: string; hasEOL?: boolean } => 'str' in item)
            .map((item) => {
              const text = item.str.trim();
              if (pageNumber === 1 && text) openingLines.push(text);
              return `${text}${item.hasEOL ? '\n' : ' '}`;
            });
          const pageText = parts.join('').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
          pages.push(`[Page ${pageNumber}]\n${pageText}`);
        } finally {
          page.cleanup();
        }
      }

      const combined = pages.join('\n\n');
      const searchable = combined.replace(/\[Page \d+\]/g, '').trim().length >= 200;
      const titleFromPage = openingLines.find((line) => line.length >= 15 && line.length <= 240 && !/^(arxiv|doi|abstract|proceedings)/i.test(line));
      const abstractMatch = combined.match(/\bAbstract\b[\s:.-]*([\s\S]{100,1600}?)(?:\n\s*(?:1\.?\s+)?Introduction\b|\[Page 2\])/i);
      const dateText = cleanMetadata(info.CreationDate);
      const yearMatch = `${openingLines.join(' ')} ${dateText}`.match(/\b(19|20)\d{2}\b/);
      const metadataTitle = cleanMetadata(info.Title);
      const usefulMetadataTitle = /\.(?:dvi|pdf|ps|tex)$/i.test(metadataTitle) || metadataTitle.length < 4 ? '' : metadataTitle;
      const title = usefulMetadataTitle || cleanMetadata(titleFromPage) || fallbackTitle;

      return {
        title,
        authors: cleanMetadata(info.Author),
        year: yearMatch?.[0] ?? '',
        abstract: cleanMetadata(abstractMatch?.[1]).slice(0, 1500),
        pageCount,
        searchable,
        extractedText: combined,
      };
    } finally {
      await loadingTask.destroy();
    }
  }
}
