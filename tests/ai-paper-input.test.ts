import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_AI_PAGES, MAX_PDF_BYTES, preparePaper, renderPageImages } from '../src/main/ai/paper-input';
import type { PaperSource } from '../src/main/ai/types';
import { LitRevoltDatabase } from '../src/main/database/database';
import { PdfService } from '../src/main/papers/pdf-service';
import { StorageManager } from '../src/main/settings/storage';
import { AI_PAPER_FIXTURE, AI_PAPER_PAGE_SIZES, makeAiPaperPdf } from './fixtures/ai-paper';

const directories: string[] = [];
const databases: LitRevoltDatabase[] = [];

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-ai-paper-'));
  directories.push(directory);
  const papersDirectory = path.join(directory, 'papers');
  fs.mkdirSync(papersDirectory);
  const managedPath = path.join(papersDirectory, 'synthetic.pdf');
  const bytes = makeAiPaperPdf();
  fs.writeFileSync(managedPath, bytes);
  const source: PaperSource = { managedPath, title: AI_PAPER_FIXTURE.title, searchable: true, pageCount: AI_PAPER_FIXTURE.pageCount, extractedText: AI_PAPER_FIXTURE.extractedText };
  return { directory, papersDirectory, source, bytes };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('AI document preparation', () => {
  it('renders every page in order with bounded dimensions, colored vector content, and opaque white backgrounds', async () => {
    const fixture = setup();
    const paper = await preparePaper(fixture.source, fixture.papersDirectory, 'page-images');
    expect(paper.images?.map((page) => page.page)).toEqual([1, 2, 3]);
    expect(paper.pdf).toBeUndefined();
    expect(JSON.parse(paper.pageText).map((page: { page: number }) => page.page)).toEqual([1, 2, 3]);
    for (const [index, page] of paper.images!.entries()) {
      const bytes = Buffer.from(page.data, 'base64');
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const image = await loadImage(bytes);
      const [width, height] = AI_PAPER_PAGE_SIZES[index];
      const scale = Math.min(2, 2048 / Math.max(width, height));
      expect([image.width, image.height]).toEqual([Math.ceil(width * scale), Math.ceil(height * scale)]);
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(2048);
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data);
      expect(pixel(1, 1)).toEqual([255, 255, 255, 255]);
      expect(pixel(32 * scale, (height - 32) * scale)).toEqual([
        index === 0 ? 255 : 0, index === 1 ? 255 : 0, index === 2 ? 255 : 0, 255,
      ]);
      if (index === 0) {
        expect(pixel(185 * scale, (height - 155) * scale)).toEqual([0, 0, 255, 255]);
        expect(pixel(105 * scale, (height - 155) * scale)).toEqual([255, 255, 255, 255]);
      }
      canvas.width = 1;
      canvas.height = 1;
    }
  });

  it('preserves original PDF bytes and page-aware quotation text for native PDF providers', async () => {
    const fixture = setup();
    const paper = await preparePaper(fixture.source, fixture.papersDirectory, 'pdf');
    expect(Buffer.from(paper.pdf!, 'base64')).toEqual(fixture.bytes);
    expect(paper.images).toBeUndefined();
    expect(JSON.parse(paper.pageText)[2]).toMatchObject({ page: 3, text: expect.stringContaining('energy e in joules equals twice the distance') });
  });

  it('rejects files outside managed storage, including sibling-prefix paths and a directory junction', async () => {
    const fixture = setup();
    const outside = path.join(fixture.directory, 'papers-other');
    fs.mkdirSync(outside);
    const outsideFile = path.join(outside, 'outside.pdf');
    fs.writeFileSync(outsideFile, fixture.bytes);
    await expect(preparePaper({ ...fixture.source, managedPath: outsideFile }, fixture.papersDirectory, 'pdf')).rejects.toThrow('outside its managed PDF folder');
    const link = path.join(fixture.papersDirectory, 'linked');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await expect(preparePaper({ ...fixture.source, managedPath: path.join(link, 'outside.pdf') }, fixture.papersDirectory, 'pdf')).rejects.toThrow('outside its managed PDF folder');
    } finally { fs.unlinkSync(link); }
  });

  it('rejects unsearchable, invalid, oversize, and excessive-page inputs before preparing a payload', async () => {
    const fixture = setup();
    await expect(preparePaper({ ...fixture.source, searchable: false }, fixture.papersDirectory, 'pdf')).rejects.toThrow('searchable text');
    await expect(preparePaper({ ...fixture.source, pageCount: MAX_AI_PAGES + 1 }, fixture.papersDirectory, 'pdf')).rejects.toThrow(`over ${MAX_AI_PAGES} pages`);
    fs.writeFileSync(fixture.source.managedPath, 'This is not a PDF.');
    await expect(preparePaper(fixture.source, fixture.papersDirectory, 'pdf')).rejects.toThrow('not a valid PDF');
    fs.truncateSync(fixture.source.managedPath, MAX_PDF_BYTES + 1);
    await expect(preparePaper(fixture.source, fixture.papersDirectory, 'pdf')).rejects.toThrow('30 MB');
  });

  it('checks the actual rendered document count and the 600-page application ceiling', async () => {
    await expect(renderPageImages(makeAiPaperPdf(), 2)).rejects.toThrow('page count changed');
    await expect(renderPageImages(makeAiPaperPdf(MAX_AI_PAGES + 1))).rejects.toThrow(`over ${MAX_AI_PAGES} pages`);
    await expect(renderPageImages(makeAiPaperPdf(1), 1)).resolves.toHaveLength(1);
  });

  it('prepares a managed paper privately for grading while the reader remains locked out of the PDF', async () => {
    const fixture = setup();
    const storage = new StorageManager(path.join(fixture.directory, 'bootstrap'));
    storage.initialize(path.join(fixture.directory, 'library'));
    const database = new LitRevoltDatabase(storage.databasePath);
    databases.push(database);
    const papers = new PdfService(database, storage);
    const imported = await papers.importFile(fixture.source.managedPath);
    const source = database.getPaperSource(imported.paper.id);
    expect(source.searchable).toBe(true);
    expect(source.extractedText).toContain('E = 2d');
    expect(source.extractedText).toContain('nine trials while the baseline completed six trials');
    const reviewId = database.startReview(imported.paper.id);
    database.saveQuiz(reviewId, 1, AI_PAPER_FIXTURE.questions);
    expect(() => papers.readPdf(imported.paper.id)).toThrow(/hidden.*quiz/i);
    const prepared = await preparePaper(source, storage.papersDirectory, 'page-images');
    expect(prepared.images).toHaveLength(3);
    expect(() => papers.readPdf(imported.paper.id)).toThrow(/hidden.*quiz/i);
    expect(database.getPaper(imported.paper.id).activeQuizReviewId).toBe(reviewId);
  });
});
