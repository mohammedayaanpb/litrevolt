import type { AiProviderConfig, AiProviderId, AiProvenance } from '../../shared/types';

export interface PaperSource {
  managedPath: string;
  searchable: boolean;
  title: string;
  pageCount: number;
  extractedText: string;
}

export interface PageImage { page: number; data: string }
export interface PreparedPaper {
  title: string;
  pageCount: number;
  pageText: string;
  documentMode: AiProvenance['documentMode'];
  pdf?: string;
  images?: PageImage[];
}

export interface AiRequest {
  model: string;
  system: string;
  prompt: string;
  paper: PreparedPaper;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
}

export interface AiResponse {
  text: string;
  status: 'complete' | 'truncated' | 'refused' | 'incomplete';
  model: string;
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly documentMode: AiProvenance['documentMode'];
  complete(request: AiRequest): Promise<AiResponse>;
}

export type ProviderFactory = (provider: AiProviderId, config: AiProviderConfig, apiKey: string) => AiProvider;
export interface AiResult<T> { value: T; provenance: AiProvenance }
