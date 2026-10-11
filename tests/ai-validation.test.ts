import { describe, expect, it } from 'vitest';
import { allocateQuestionMaxScores, citationAppearsOnPage, extractedPages, normalizeCitationText } from '../src/main/ai/validation';

describe('Shared AI structured-output validation helpers', () => {
  it('allocates exact integer quiz weights that always total 100', () => {
    expect(allocateQuestionMaxScores(5)).toEqual([20, 20, 20, 20, 20]);
    expect(allocateQuestionMaxScores(6)).toEqual([17, 17, 17, 17, 16, 16]);
    expect(allocateQuestionMaxScores(6).reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it('normalizes PDF line-break hyphenation and typographic quotes', () => {
    expect(normalizeCitationText('wave-\nlength “model”')).toBe('wavelength "model"');
    expect(citationAppearsOnPage('The wave-\nlength “model” is revised.', 'wavelength "model"')).toBe(true);
  });

  it('still rejects paraphrases and very short citations', () => {
    expect(citationAppearsOnPage('The model is revised.', 'model')).toBe(false);
    expect(citationAppearsOnPage('The model is revised.', 'The approach is changed.')).toBe(false);
  });

  it('rejects added words even in an otherwise matching long quote', () => {
    const page = 'Most importantly, we show that the wideband attenuation coefficients for the direct signal and the backscattered signal are different, despite the current model treating them as equal.';
    const quote = 'Most importantly, we show that the wideband attenuation coefficients for the direct signal and the backscattered signal are different, despite the fact that the current model treating them as equal.';
    expect(citationAppearsOnPage(page, quote)).toBe(false);
  });

  it('requires a contiguous excerpt when extraction inserts a figure caption', () => {
    const page = 'Most importantly, we show that the wideband attenuation coefficients for the direct signal and the backscattered signal are different, despite the Figure 2 Ambient light attenuates exponentially with depth reaching an object and attenuates further between the object and the sensor. This signal is further degraded by light scattered by particles from all directions towards the sensor. fact that the current model assumes them to be the same.';
    const quote = 'Most importantly, we show that the wideband attenuation coefficients for the direct signal and the backscattered signal are different, despite the fact that the current model assumes them to be the same.';
    expect(citationAppearsOnPage(page, quote)).toBe(false);
    expect(citationAppearsOnPage(page, 'the wideband attenuation coefficients for the direct signal and the backscattered signal are different')).toBe(true);
  });

  it('rejects changes to negation and numeric evidence', () => {
    const page = 'The model does not improve accuracy across the five controlled test cases.';
    expect(citationAppearsOnPage(page, 'The model does improve accuracy across the five controlled test cases.')).toBe(false);
    expect(citationAppearsOnPage(page, 'The model does not improve accuracy across the six controlled test cases.')).toBe(false);
  });

  it('keeps evidence confined to the right PDF page, including CRLF extraction', () => {
    const pages = extractedPages('[Page 1]\r\nFirst page evidence.\r\n\r\n[Page 2]\r\nSecond page evidence.');
    expect([...pages.keys()]).toEqual([1, 2]);
    expect(citationAppearsOnPage(pages.get(1)!, 'Second page evidence.')).toBe(false);
    expect(citationAppearsOnPage(pages.get(2)!, 'Second page evidence.')).toBe(true);
  });

  it('rejects a fluent but substantively paraphrased long citation', () => {
    const page = 'The revised model reduces reconstruction error in controlled experiments across two sea locations.';
    const quote = 'The proposed method achieves superior perceptual quality in broad real-world benchmarks across many oceans.';
    expect(citationAppearsOnPage(page, quote)).toBe(false);
  });
});
