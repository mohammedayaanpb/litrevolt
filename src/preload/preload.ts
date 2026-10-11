import { contextBridge, ipcRenderer } from 'electron';
import type { LitRevoltAPI } from '../shared/types';
import { userMessageForError } from '../shared/errors';

const fallbacks: Record<string, string> = {
  'app:get-settings': 'LitRevolt could not open its local settings. Restart the app and try again.',
  'app:choose-data-directory': 'LitRevolt could not open the folder chooser.',
  'app:complete-setup': 'LitRevolt could not complete local setup. Check the selected folder and try again.',
  'app:save-settings': 'LitRevolt could not save these settings.',
  'app:save-api-key': 'LitRevolt could not save the API key securely.',
  'app:test-api-key': 'LitRevolt could not test the selected AI provider connection.',
  'app:create-backup': 'LitRevolt could not create the database backup.',
  'app:get-about': 'LitRevolt could not load application information.',
  'app:open-external': 'LitRevolt could not open that secure link.',
  'library:get': 'LitRevolt could not load the local library.',
  'library:import-paper': 'LitRevolt could not import this PDF. The file may be damaged, encrypted, or unsupported.',
  'library:update-paper': 'LitRevolt could not update this paper.',
  'library:delete-paper': 'LitRevolt could not remove this paper.',
  'library:get-pdf-data': 'LitRevolt could not open the managed PDF.',
  'library:create-project': 'LitRevolt could not create this project.',
  'library:update-project': 'LitRevolt could not update this project.',
  'library:delete-project': 'LitRevolt could not delete this project.',
  'library:set-paper-projects': 'LitRevolt could not update the paper’s projects.',
  'reviews:start': 'LitRevolt could not start this review.',
  'reviews:get': 'LitRevolt could not load this review.',
  'reviews:list': 'LitRevolt could not load your reviews.',
  'reviews:list-for-paper': 'LitRevolt could not load this paper’s review history.',
  'reviews:rename': 'LitRevolt could not rename this review.',
  'reviews:delete': 'LitRevolt could not delete this review.',
  'reviews:save-pass-notes': 'LitRevolt could not save these reading notes.',
  'reviews:generate-quiz': 'LitRevolt could not generate the quiz.',
  'reviews:submit-quiz': 'LitRevolt could not grade the quiz.',
  'reviews:complete-pass': 'LitRevolt could not complete this pass.',
  'reviews:save-writing': 'LitRevolt could not save this writing.',
  'reviews:evaluate-writing': 'LitRevolt could not evaluate this writing.',
  'reviews:list-annotations': 'LitRevolt could not load annotations.',
  'reviews:save-annotation': 'LitRevolt could not save this annotation.',
  'reviews:delete-annotation': 'LitRevolt could not delete this annotation.',
};

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  try {
    return await ipcRenderer.invoke(channel, ...args) as T;
  } catch (error) {
    throw new Error(userMessageForError(error, fallbacks[channel] ?? 'LitRevolt could not complete that action.'));
  }
};

const api: LitRevoltAPI = {
  app: {
    getSettings: () => invoke('app:get-settings'),
    chooseDataDirectory: () => invoke('app:choose-data-directory'),
    completeSetup: (input) => invoke('app:complete-setup', input),
    saveSettings: (input) => invoke('app:save-settings', input),
    saveApiKey: (input) => invoke('app:save-api-key', input),
    testApiKey: (input) => invoke('app:test-api-key', input),
    createBackup: () => invoke('app:create-backup'),
    getAbout: () => invoke('app:get-about'),
    openExternal: (url) => invoke('app:open-external', url),
  },
  library: {
    get: () => invoke('library:get'),
    importPaper: (projectId) => invoke('library:import-paper', projectId),
    updatePaper: (id, input) => invoke('library:update-paper', id, input),
    deletePaper: (id) => invoke('library:delete-paper', id),
    getPdfData: (id) => invoke('library:get-pdf-data', id),
    createProject: (input) => invoke('library:create-project', input),
    updateProject: (id, input) => invoke('library:update-project', id, input),
    deleteProject: (id) => invoke('library:delete-project', id),
    setPaperProjects: (paperId, projectIds) => invoke('library:set-paper-projects', paperId, projectIds),
  },
  reviews: {
    start: (paperId, projectId) => invoke('reviews:start', paperId, projectId),
    get: (id) => invoke('reviews:get', id),
    list: () => invoke('reviews:list'),
    listForPaper: (paperId) => invoke('reviews:list-for-paper', paperId),
    rename: (id, name) => invoke('reviews:rename', id, name),
    delete: (id) => invoke('reviews:delete', id),
    savePassNotes: (id, pass, notes) => invoke('reviews:save-pass-notes', id, pass, notes),
    generateQuiz: (id, pass) => invoke('reviews:generate-quiz', id, pass),
    submitQuiz: (id, pass, answers) => invoke('reviews:submit-quiz', id, pass, answers),
    completePass: (id, pass) => invoke('reviews:complete-pass', id, pass),
    saveWriting: (id, kind, text) => invoke('reviews:save-writing', id, kind, text),
    evaluateWriting: (id, kind) => invoke('reviews:evaluate-writing', id, kind),
    listAnnotations: (paperId, reviewId) => invoke('reviews:list-annotations', paperId, reviewId),
    saveAnnotation: (input) => invoke('reviews:save-annotation', input),
    deleteAnnotation: (id) => invoke('reviews:delete-annotation', id),
  },
};

contextBridge.exposeInMainWorld('litrevolt', api);
