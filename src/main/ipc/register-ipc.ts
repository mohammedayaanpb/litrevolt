import { app, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import type { PassNumber } from '../../shared/types';
import type { AppServices } from '../services';
import { MAX_HIGHLIGHT_RECTS } from '../../shared/highlights';
import { AI_PROVIDERS, PROVIDER_LABELS, validateProviderConfig } from '../../shared/config';

const idSchema = z.string().uuid();
const passSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const writingKindSchema = z.enum(['summary', 'critical-review']);
const providerSchema = z.enum(AI_PROVIDERS);
const providerConfigSchema = z.object({
  model: z.string().trim().min(1).max(200),
  anthropicWorkspaceId: z.string().trim().max(110).optional(),
}).strict();
const apiKeySchema = z.string().trim().min(1).max(20000);

export function registerIpc(services: AppServices): void {
  ipcMain.handle('app:get-settings', () => services.getSettings());
  ipcMain.handle('app:choose-data-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose the LitRevolt data folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('app:complete-setup', (_event, raw) => {
    const input = z.object({
      dataDirectory: z.string().min(1), privacyAccepted: z.boolean(), apiKey: apiKeySchema.optional(),
      provider: providerSchema.optional(), model: z.string().trim().min(1).max(200).optional(),
    }).strict().parse(raw);
    return services.completeSetup(input);
  });
  ipcMain.handle('app:save-settings', (_event, raw) => {
    const input = z.object({
      activeProvider: providerSchema.optional(),
      providers: z.object({ anthropic: providerConfigSchema.optional(), openai: providerConfigSchema.optional(), kimi: providerConfigSchema.optional(), gemini: providerConfigSchema.optional() }).strict().optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(), automaticBackups: z.boolean().optional(),
    }).strict().parse(raw);
    return services.saveSettings(input);
  });
  ipcMain.handle('app:save-api-key', (_event, raw) => {
    const input = z.object({ provider: providerSchema, apiKey: apiKeySchema }).strict().parse(raw);
    services.requireCredentials().saveApiKey(input.apiKey, input.provider);
    return { ok: true, message: `${PROVIDER_LABELS[input.provider]} API key saved in your operating system credential vault.` };
  });
  ipcMain.handle('app:test-api-key', async (_event, raw) => {
    const input = providerConfigSchema.extend({ provider: providerSchema, apiKey: apiKeySchema.optional() }).strict().parse(raw);
    const configuration = validateProviderConfig(input.provider, input);
    await services.requireAi().testConnection({ ...input, ...configuration });
    return { ok: true, message: `Connected to ${PROVIDER_LABELS[input.provider]} successfully with ${configuration.model}.` };
  });
  ipcMain.handle('app:create-backup', () => services.requireBackups().create());
  ipcMain.handle('app:get-about', () => ({ version: app.getVersion(), githubUrl: 'https://github.com/mohammedayaanpb/litrevolt' }));
  ipcMain.handle('app:open-external', async (_event, raw) => {
    const url = z.string().url().parse(raw);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('LitRevolt only opens secure web links.');
    await shell.openExternal(url);
  });

  ipcMain.handle('library:get', () => services.requireDatabase().getLibrary());
  ipcMain.handle('library:import-paper', async (_event, raw) => {
    const projectId = z.string().uuid().optional().parse(raw);
    const result = await dialog.showOpenDialog({
      title: 'Import a research paper', buttonLabel: 'Import paper', properties: ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled) return null;
    return services.requirePapers().importFile(result.filePaths[0], projectId);
  });
  ipcMain.handle('library:update-paper', (_event, rawId, rawInput) => {
    const id = idSchema.parse(rawId);
    const input = z.object({
      title: z.string().trim().min(1).max(500).optional(), authors: z.string().max(2000).optional(),
      year: z.string().max(20).optional(), abstract: z.string().max(10000).optional(),
      projectIds: z.array(idSchema).max(1000).optional(),
    }).parse(rawInput);
    return services.requireDatabase().updatePaper(id, input);
  });
  ipcMain.handle('library:delete-paper', (_event, rawId) => services.requirePapers().deletePaper(idSchema.parse(rawId)));
  ipcMain.handle('library:get-pdf-data', (_event, rawId) => services.requirePapers().readPdf(idSchema.parse(rawId)));
  ipcMain.handle('library:create-project', (_event, raw) => {
    const input = z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(5000) }).parse(raw);
    return services.requireDatabase().createProject(input);
  });
  ipcMain.handle('library:update-project', (_event, rawId, raw) => {
    const input = z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(5000) }).parse(raw);
    return services.requireDatabase().updateProject(idSchema.parse(rawId), input);
  });
  ipcMain.handle('library:delete-project', (_event, rawId) => services.requireDatabase().deleteProject(idSchema.parse(rawId)));
  ipcMain.handle('library:set-paper-projects', (_event, rawPaperId, rawIds) => {
    const paperId = idSchema.parse(rawPaperId);
    const projectIds = z.array(idSchema).parse(rawIds);
    services.requireDatabase().setPaperProjects(paperId, projectIds);
  });

  ipcMain.handle('reviews:start', (_event, rawPaperId, rawProjectId) => {
    const paperId = idSchema.parse(rawPaperId);
    const projectId = z.string().uuid().optional().parse(rawProjectId);
    return services.requireReviews().start(paperId, projectId);
  });
  ipcMain.handle('reviews:get', (_event, rawId) => services.requireReviews().get(idSchema.parse(rawId)));
  ipcMain.handle('reviews:list', () => services.requireDatabase().listReviews());
  ipcMain.handle('reviews:list-for-paper', (_event, rawPaperId) => services.requireDatabase().listReviewsForPaper(idSchema.parse(rawPaperId)));
  ipcMain.handle('reviews:rename', (_event, rawId, rawName) => {
    const id = idSchema.parse(rawId);
    const name = z.string().trim().min(1, 'Review name is required.').max(200, 'Review name must be 200 characters or fewer.').parse(rawName);
    return services.requireDatabase().renameReview(id, name);
  });
  ipcMain.handle('reviews:delete', (_event, rawId) => services.requireDatabase().deleteReview(idSchema.parse(rawId)));
  ipcMain.handle('reviews:save-pass-notes', (_event, rawId, rawPass, rawNotes) => {
    const notes = z.record(z.string(), z.string()).parse(rawNotes);
    return services.requireReviews().savePassNotes(idSchema.parse(rawId), passSchema.parse(rawPass) as PassNumber, notes);
  });
  ipcMain.handle('reviews:generate-quiz', (_event, rawId, rawPass) =>
    services.requireReviews().generateQuiz(idSchema.parse(rawId), passSchema.parse(rawPass) as PassNumber));
  ipcMain.handle('reviews:submit-quiz', (_event, rawId, rawPass, rawAnswers) => {
    const answers = z.record(z.string(), z.string()).parse(rawAnswers);
    return services.requireReviews().submitQuiz(idSchema.parse(rawId), passSchema.parse(rawPass) as PassNumber, answers);
  });
  ipcMain.handle('reviews:complete-pass', (_event, rawId, rawPass) =>
    services.requireReviews().completePass(idSchema.parse(rawId), passSchema.parse(rawPass) as PassNumber));
  ipcMain.handle('reviews:save-writing', (_event, rawId, rawKind, rawText) =>
    services.requireReviews().saveWriting(idSchema.parse(rawId), writingKindSchema.parse(rawKind), z.string().max(100000).parse(rawText)));
  ipcMain.handle('reviews:evaluate-writing', (_event, rawId, rawKind) =>
    services.requireReviews().evaluateWriting(idSchema.parse(rawId), writingKindSchema.parse(rawKind)));
  ipcMain.handle('reviews:list-annotations', (_event, rawPaperId, rawReviewId) =>
    services.requireDatabase().listAnnotations(idSchema.parse(rawPaperId), z.string().uuid().optional().parse(rawReviewId)));
  ipcMain.handle('reviews:save-annotation', (_event, raw) => {
    const rectSchema = z.object({
      x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
      width: z.number().finite().positive().max(1), height: z.number().finite().positive().max(1),
    }).superRefine((value, context) => {
      if (value.x + value.width > 1.000001) context.addIssue({ code: 'custom', path: ['width'], message: 'Highlight extends beyond the page width.' });
      if (value.y + value.height > 1.000001) context.addIssue({ code: 'custom', path: ['height'], message: 'Highlight extends beyond the page height.' });
    });
    const input = z.object({
      id: z.string().uuid().optional(), paperId: idSchema, reviewId: z.string().uuid().nullable(), page: z.number().int().positive(),
      kind: z.enum(['note', 'highlight']), content: z.string().max(20000), quote: z.string().max(20000), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      rects: z.array(rectSchema).max(MAX_HIGHLIGHT_RECTS).optional().default([]),
    }).superRefine((value, context) => {
      if (value.kind === 'highlight' && !value.quote.trim()) context.addIssue({ code: 'custom', path: ['quote'], message: 'A highlight requires an evidence passage.' });
      if (value.kind === 'note' && !value.content.trim()) context.addIssue({ code: 'custom', path: ['content'], message: 'A note requires content.' });
    }).parse(raw);
    return services.requireDatabase().saveAnnotation(input);
  });
  ipcMain.handle('reviews:delete-annotation', (_event, rawId) => services.requireDatabase().deleteAnnotation(idSchema.parse(rawId)));
}
