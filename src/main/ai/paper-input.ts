import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import type { Canvas } from '@napi-rs/canvas';
import { installPdfGeometryGlobals } from '../papers/pdf-service';
import { extractedPages } from './validation';
import type { PaperSource, PreparedPaper, PageImage } from './types';

export const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 90_000_000; // Leaves room under Kimi's 100 MB request limit.
export const MAX_AI_PAGES = 600;

export async function renderPageImages(bytes: Uint8Array, expectedPages?: number): Promise<PageImage[]> {
  await installPdfGeometryGlobals();
  const [{ getDocument }, { createCanvas }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'), import('@napi-rs/canvas'),
  ]);
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const document = await loading.promise;
    if (expectedPages !== undefined && document.numPages !== expectedPages) throw new Error('AI review is unavailable because the PDF page count changed. Import the paper again.');
    if (document.numPages > MAX_AI_PAGES) throw new Error(`AI review is unavailable for PDFs over ${MAX_AI_PAGES} pages. Import a smaller complete paper.`);
    const images: PageImage[] = [];
    let totalBytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      let canvas: Canvas | undefined;
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 2048 / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: '#ffffff' }).promise;
        const data = canvas.toBuffer('image/png').toString('base64');
        totalBytes += data.length;
        if (totalBytes > MAX_IMAGE_BYTES) throw new Error('AI review is unavailable because all page images exceed the Kimi request limit. Use another provider or import a smaller complete paper.');
        images.push({ page: pageNumber, data });
      } finally {
        page.cleanup();
        if (canvas) { canvas.width = 1; canvas.height = 1; }
      }
    }
    return images;
  } finally { await loading.destroy(); }
}

export async function preparePaper(source: PaperSource, papersDirectory: string, mode: PreparedPaper['documentMode']): Promise<PreparedPaper> {
  if (!source.searchable) throw new Error('AI review is unavailable for this PDF because searchable text could not be extracted.');
  // Resolve symlinks as well as '..'; papers can be accessed privately during a
  // closed-book quiz, but must never escape the managed PDF directory.
  const root = fs.realpathSync(papersDirectory);
  const filename = fs.realpathSync(source.managedPath);
  const relative = path.relative(root, filename);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('LitRevolt refused to send a file outside its managed PDF folder.');
  }
  if (fs.statSync(filename).size > MAX_PDF_BYTES) throw new Error('This PDF is larger than the 30 MB LitRevolt AI request limit. Compress it and import the smaller copy.');
  if (source.pageCount > MAX_AI_PAGES) throw new Error(`AI review is unavailable for PDFs over ${MAX_AI_PAGES} pages. Import a smaller complete paper.`);
  const bytes = fs.readFileSync(filename);
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('The selected file is not a valid PDF.');
  const paper: PreparedPaper = {
    title: source.title, pageCount: source.pageCount, documentMode: mode,
    pageText: JSON.stringify(Array.from(extractedPages(source.extractedText), ([page, text]) => ({ page, text }))),
  };
  if (mode === 'pdf') paper.pdf = bytes.toString('base64');
  else paper.images = await renderPageImages(bytes, source.pageCount);
  return paper;
}

// A tiny, generated PDF contains no reader data and no text revealing the answer.
export function visualProbe(): { bytes: Buffer; color: string; shape: string } {
  const colors = [{ name: 'red', rgb: '1 0 0' }, { name: 'blue', rgb: '0 0 1' }, { name: 'green', rgb: '0 0.7 0' }];
  const shapes = [
    { name: 'square', draw: '32 32 64 64 re f' },
    { name: 'triangle', draw: '64 104 m 24 24 l 104 24 l h f' },
    { name: 'circle', draw: '96 64 m 96 81.673 81.673 96 64 96 c 46.327 96 32 81.673 32 64 c 32 46.327 46.327 32 64 32 c 81.673 32 96 46.327 96 64 c f' },
  ];
  const color = colors[randomInt(colors.length)];
  const shape = shapes[randomInt(shapes.length)];
  const content = `${color.rgb} rg ${shape.draw}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 128 128] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { bytes: Buffer.from(pdf), color: color.name, shape: shape.name };
}
