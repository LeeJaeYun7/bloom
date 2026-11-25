/** Shared persisted data contracts. Runtime validators still validate external input. */
export type Channel = 'Instagram' | 'Facebook' | 'YouTube';
export type Aspect = '9:16' | '1:1';
export type VideoStyle = 'warm' | 'bold' | 'minimal';
export type Motion = 'gentle' | 'dynamic' | 'still';
export interface Scene { title: string; body: string }
export interface VideoPlan { aspect: Aspect; duration: number; style: VideoStyle; motion: Motion; scenes: Scene[] }
export interface Brand { name: string; url: string; description: string; color: string; tone: string }
export interface Brief { product: string; audience: string; tone: string; goal: string }
export interface Message { role: 'user' | 'assistant'; text: string }
export type VideoStatus = 'queued' | 'rendering' | 'ready' | 'failed';
export interface Execution { tool: 'update_plan' | 'render_video'; status: 'completed' | VideoStatus; at: string; jobId?: string; error?: string }
export interface Creative {
  id: string; brand: string; name: string; prompt: string; headline: string; caption: string; script: string;
  channel: Channel; format: '이미지 광고' | '15초 스토리보드' | '15초 광고 영상'; variant: number;
  color?: string; image?: string; imageRef?: string; imageVersion?: string;
  videoDraft?: VideoPlan; latestVideoJobId?: string; directorReady?: boolean; directorBrief?: Brief;
  conversation?: Message[]; executions?: Execution[];
  batchId?: string; batchIndex?: number; batchAngle?: string; batchHypothesis?: string;
}
export interface Asset { id: string; data: string }
export interface Campaign { id: string; name: string; channel: Channel; budget: number; creativeId: string; status?: string; sample?: boolean }
export interface Workspace { brand: Brand; creatives: Creative[]; campaigns: Campaign[]; assets?: Asset[]; performance?: PerformanceData; autopilot?: boolean }
export interface WorkspaceRecord { revision: number; state: Workspace | null }
export interface VideoJob {
  id: string; creativeId: string; batchId: string | null; name: string; brand: string; color: string; imageVersion: string | null;
  plan: VideoPlan; fingerprint: string; hasAudio: boolean; status: VideoStatus; progress: number;
  duration: number; width: number; height: number; createdAt: string; updatedAt: string; error?: string | null;
}
export interface PublicVideoJob extends VideoJob { fileUrl: string | null; posterUrl: string | null }
export interface VideoRequest { creativeId: string; plan: unknown; audio?: string | null }
export interface MetricsInput { spend: number; impressions: number; clicks: number; purchases: number; revenue: number; refunds: number }
export interface Totals extends MetricsInput { netRevenue: number; ctr: number | null; cvr: number | null; cpa: number | null; roas: number | null }
export interface Metrics extends Totals { contribution: number; cvrInterval: [number, number] | null; budgetRemaining: number }
export type DecisionAction = 'hold' | 'iterate' | 'review_pause' | 'review_scale';
export interface Suggestion { action: DecisionAction; reason: string }
export type CreativeSnapshot = Pick<Creative, 'brand' | 'name' | 'headline' | 'caption' | 'script' | 'batchAngle' | 'batchHypothesis' | 'videoDraft' | 'imageVersion' | 'format' | 'latestVideoJobId'>;
export interface ExperimentArm { creativeId: string; hypothesis: string; snapshot: CreativeSnapshot }
export interface Experiment {
  id: string; name: string; brand: string; product: string; audience: string; channel: Channel; landingUrl: string;
  attribution: string; currency: 'KRW'; marginRate: number; targetCpa: number; maxSpend: number;
  startDate: string; endDate: string; arms: ExperimentArm[]; createdAt: string;
}
export interface Observation extends MetricsInput { id: string; experimentId: string; creativeId: string; date: string; source: string; recordedAt: string }
export interface Decision { id: string; experimentId: string; action: DecisionAction; note: string; at: string; evidence: { metrics: Metrics; suggestion: Suggestion }; execution: 'recorded_only' }
export interface ForecastBaseline extends Totals { cpc: number; aov: number; cvrInterval: [number,number]; experiments: number }
export interface ForecastAvailable {
  available: true; method: 'historical-cohort-v1'; asOf: string; baseline: ForecastBaseline;
  scenario: { budget: number; expectedPurchases: number; purchasesRange: number[]; expectedCpa: number; expectedRoas: number; contributionRange: number[] };
  evidence: Observation[]; assumptions: string;
}
export interface ForecastUnavailable { available: false; reason: string; sample?: { experiments: number; clicks: number; purchases: number } }
export type ForecastCandidate = ForecastAvailable | ForecastUnavailable;
export interface Forecast extends ForecastAvailable { id: string; experimentId: string }
export interface ImportRecord { id: string; experimentId: string; at: string; source: string; rows: number; updated: number; replaced: Observation[] }
export interface PerformanceData { experiments: Experiment[]; observations: Observation[]; decisions: Decision[]; forecasts: Forecast[]; imports: ImportRecord[] }
export interface ExperimentReport extends Experiment {
  metrics: Metrics; suggestion: Suggestion; arms: Array<ExperimentArm & {metrics: Metrics}>; rows: number;
  forecast: Forecast | null; forecastCandidate: ForecastCandidate | null;
  validation: { observedCvr: number; expectedCvr: number; absoluteError: number; withinHistoricalInterval: boolean; note: string } | null;
  decisions: Decision[];
}
export interface PerformanceReport { experiments: ExperimentReport[]; observationCount: number }
export interface ModelResponse { output?: Array<{ content?: Array<{type: string; text?: string}> }> }
export type CallModel = (endpoint: string, payload: Record<string, unknown>) => Promise<ModelResponse>;
export type ModelContent = {type: 'input_text'; text: string} | {type: 'input_image'; image_url: string; detail: 'low'};
export interface BatchInput { count: number; duration: number; aspect: Aspect; product: string; goal: string; audience: string; assetId?: string; creativeId?: string }
export interface BatchVariant { angle: string; hypothesis: string; name: string; headline: string; caption: string; script: string; plan: VideoPlan }
export interface BatchResult { variants: BatchVariant[]; duration: number; aspect: Aspect }
export interface DirectorResult { reply: string; action: 'ask' | 'update' | 'render'; ready: boolean; audio: 'keep' | 'mute'; brief: Brief; creative: Pick<Creative,'brand'|'name'|'headline'|'caption'|'script'|'channel'>; plan: VideoPlan }
export interface AppError extends Error { status?: number; code?: string; reconnect?: boolean }
export interface OperatorReport { revision: string; ready: boolean; checks: Array<{name: string; present: boolean; valid: boolean; error: string | null}>; callbackUrl: string | null; values: Record<string,string>; configuredSecrets: Record<string,boolean> }
export interface ConnectionStatus {configured: boolean; model: string}
export interface VideoCapabilities {available: boolean; duration: number; minDuration: number; maxDuration: number; aspects: Aspect[]}
export interface PerformanceMutationResult extends WorkspaceRecord {state: Workspace; report: PerformanceReport}
export interface ApiRoutes {
  '/api/state': WorkspaceRecord;
  '/api/status': ConnectionStatus;
  '/api/settings': ConnectionStatus;
  '/api/director': DirectorResult;
  '/api/batch-plan': BatchResult;
  '/api/video-plan': VideoPlan;
  '/api/videos/status': VideoCapabilities;
  '/api/videos/batch': {jobs: PublicVideoJob[]};
  '/api/performance': PerformanceReport;
  '/api/creative': Pick<Creative,'name'|'headline'|'caption'|'script'>;
}
