import type { QuizQuestion } from '../../src/shared/types';

const pageLines = [
  [
    'Synthetic Controller Study',
    'We compare a baseline controller with a proposed controller in ten trials.',
    'The figure compares controller performance using blue bars on shared axes.',
    'Bar heights represent completed trials and share the same zero baseline.',
  ],
  [
    'Table 1: Measured trial outcomes',
    'The proposed controller completed nine trials while the baseline completed six trials.',
    'Each controller was tested in ten trials at the same laboratory site.',
  ],
  [
    'Energy model and limitations',
    'Energy E in joules equals twice the distance d measured in meters.',
    'The experiments used one laboratory site and do not establish outdoor reliability.',
    'The measured advantage needs independent replication before any general claim is justified.',
    'E = 2d',
  ],
] as const;

export const AI_PAPER_PAGE_SIZES = [[300, 400], [500, 300], [1500, 1200]] as const;

export const AI_PAPER_FIXTURE = {
  title: 'Synthetic Controller Study',
  pageCount: 3,
  extractedText: pageLines.map((lines, index) => `[Page ${index + 1}]\n${lines.join('\n')}`).join('\n\n'),
  questions: [
    { id: 'figure', type: 'short-answer', prompt: 'In Figure 1, which blue bar is taller, and what is its height ratio to the other bar?', focus: 'Visual interpretation' },
    { id: 'table', type: 'short-answer', prompt: 'According to Table 1, how many trials did each controller complete out of ten?', focus: 'Tabulated evidence' },
    { id: 'equation', type: 'short-answer', prompt: 'Using the stated energy equation, what energy is required for a distance of three meters?', focus: 'Equation reasoning' },
    { id: 'limits', type: 'short-answer', prompt: 'Does the study establish outdoor reliability, and why?', focus: 'Limitations' },
  ] satisfies QuizQuestion[],
  correctAnswers: {
    figure: 'The Proposed bar is taller: its height is one and a half times the Baseline bar height, a ratio of 3:2.',
    table: 'The proposed controller completed nine of ten trials; the baseline completed six of ten.',
    equation: 'E = 2d, so d = 3 meters requires E = 6 joules.',
    limits: 'No. Testing occurred at one laboratory site; outdoor reliability was not established and independent replication is needed.',
  },
  incorrectAnswers: {
    figure: 'The Baseline bar is taller: its height is twice the Proposed bar height.',
    table: 'The baseline completed all ten trials while the proposed controller completed none.',
    equation: 'E = d / 2, so the energy is 1.5 joules.',
    limits: 'Yes. Tests at many outdoor sites prove universal reliability and no replication is needed.',
  },
  accurateSummary: 'This synthetic study compares baseline and proposed controllers in ten trials at one laboratory site. The figure shows the Proposed bar at one and a half times the Baseline height. Table 1 reports nine completed trials for the proposed controller and six for the baseline. The energy model is E = 2d joules with distance in meters, so three meters requires six joules. The results support a measured advantage in this experiment, but do not establish outdoor reliability. Independent replication is needed before generalizing the claim.',
  inaccurateSummary: 'This study proves that a baseline controller is universally reliable outdoors and that the proposed controller is useless. The Baseline bar is twice as tall as the Proposed bar. The baseline succeeds in ten of ten trials and the proposed controller in zero. Energy follows E = d / 2, requiring 1.5 joules for three meters. Tests at many outdoor sites establish complete reliability without limitations or any need for replication.',
};

function pdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Self-contained vector/text PDF; no fixture files, font downloads, or PDF dependencies. */
export function makeAiPaperPdf(pageCount = AI_PAPER_FIXTURE.pageCount): Buffer {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Fixture page count must be a positive integer.');
  const kids = Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let index = 0; index < pageCount; index++) {
    const page = index % 3;
    const [width, height] = AI_PAPER_PAGE_SIZES[page];
    const lines = pageLines[page];
    const marker = ['1 0 0', '0 1 0', '0 0 1'][page];
    const text = lines.map((line, lineIndex) => `BT /F1 7 Tf 0 0 0 rg 18 ${height - 24 - lineIndex * 16} Td (${pdfText(line)}) Tj ET`).join('\n');
    let drawing = '';
    if (page === 0) {
      drawing = '0 0 0 RG 1 w 60 80 m 240 80 l S\n0 0 1 rg 85 80 40 60 re f 165 80 40 90 re f\nBT /F1 9 Tf 0 0 0 rg 85 65 Td (Baseline) Tj 80 0 Td (Proposed) Tj ET';
    } else if (page === 1) {
      drawing = '0 0 0 RG 1 w 70 70 240 100 re S 70 120 m 310 120 l S 200 70 m 200 170 l S\nBT /F1 11 Tf 0 0 0 rg 85 140 Td (Controller) Tj 135 0 Td (Completed / 10) Tj ET\nBT /F1 10 Tf 85 102 Td (Baseline) Tj 140 0 Td (6) Tj ET\nBT /F1 10 Tf 85 83 Td (Proposed) Tj 140 0 Td (9) Tj ET';
    }
    const content = `${text}\n${drawing}\n${marker} rg 20 20 24 24 re f\n`;
    const pageId = 4 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
