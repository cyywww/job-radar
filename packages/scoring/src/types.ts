import type {
  ConfirmedProfileView,
  JobExtraction,
  ScoringJobInput,
  ScoringTokenUsage,
} from '@job-radar/shared';

export interface ExtractionRequest {
  readonly profile: ConfirmedProfileView;
  readonly job: ScoringJobInput;
  readonly extractorVersion: string;
  readonly signal?: AbortSignal;
}

export interface AIProvider {
  readonly id: 'codex_cli';
  readonly model: string;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

export interface ExtractionResult {
  readonly extraction: JobExtraction;
  readonly usage: ScoringTokenUsage;
  readonly outputBytes: number;
}

export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}
