export type Scalar = string | number | boolean | null

export type FactRow = {
  key: string
  label: string
  values: Record<string, Scalar>
  sourceQuery: string
}

export type UnavailableSection = {
  available: false
  reason: string
}

export type AvailableSection = {
  available: true
  rows: FactRow[]
  omitted?: { count: number; sumOfOmitted: number }
}

export type FactSection = AvailableSection | UnavailableSection

export type CaptureSource = {
  zipName: string
  traceEntry: string
  configText?: string
  metadataText?: string
}

export type CaptureTarget = {
  packageName?: string
  pid?: number
  upid?: number
  versionCode?: number
  androidBuild?: string
  deviceModel?: string
  sampleFrequencyHz?: number
}

export type WindowProfile = {
  markerCount: number
  medianIntervalNs: number | null
  p90IntervalNs: number | null
}

export type AnalysisWindow = {
  source: 'actual_frame_timeline' | 'expected_frame_timeline' | 'trace_center'
  startNs: number
  endNs: number
  durationNs: number
  startOffsetNs: number
  selection: 'representative' | 'matched'
  similarityScore: number
  profile: WindowProfile
}

export type WindowSelectionRequest = {
  durationNs: number
  reference?: WindowProfile
}

export type CaptureFacts = {
  schemaVersion: 1
  captureId: string
  source: CaptureSource
  traceBounds: { startNs: number; endNs: number; durationNs: number }
  bounds: { startNs: number; endNs: number; durationNs: number }
  window: AnalysisWindow
  quality: {
    statsNonZero: Array<{ name: string; value: number; severity: string }>
    unwindErrorRatio?: number
  }
  target: CaptureTarget
  sections: Record<string, FactSection>
}

export type NormalizedPair = {
  baseline: number | null
  candidate: number | null
  deltaAbs: number | null
  deltaRatio: number | null
}

export type ComparisonItem = {
  key: string
  rowKey: string
  label: string
  metric: string
  baseline: number | null
  candidate: number | null
  deltaAbs: number | null
  deltaRatio: number | null
  normalized: {
    perSecond?: NormalizedPair
    perFrame?: NormalizedPair
    perCall?: NormalizedPair
  }
  sourceQuery: { baseline?: string; candidate?: string }
}

export type ComparisonSection = {
  available: { baseline: boolean; candidate: boolean }
  reason?: { baseline?: string; candidate?: string }
  items: ComparisonItem[]
  onlyInBaseline: ComparisonItem[]
  onlyInCandidate: ComparisonItem[]
  omitted?: { count: number; sumOfOmitted: number; limit: number }
}

export type EnvironmentDifference = {
  key: string
  baseline: Scalar | undefined
  candidate: Scalar | undefined
  different: boolean
}

export type CaptureSummary = {
  captureId: string
  source: Pick<CaptureSource, 'zipName' | 'traceEntry'>
  bounds: CaptureFacts['bounds']
  traceBounds: CaptureFacts['traceBounds']
  window: CaptureFacts['window']
  quality: CaptureFacts['quality']
  target: CaptureFacts['target']
}

export type FactPack = {
  schemaVersion: 1
  baseline: CaptureSummary
  candidate: CaptureSummary
  denominators: {
    baseline: { durationNs: number; frameCount: number | null }
    candidate: { durationNs: number; frameCount: number | null }
  }
  environment: EnvironmentDifference[]
  sections: Record<string, ComparisonSection>
  budget: { byteLength: number; maxBytes: number; initialLimit: number; finalLimit: number; reduced: boolean }
}

export type ProviderId = 'openai' | 'openrouter'

export type AnalysisSettings = {
  provider: ProviderId
  apiKey: string
  model: string
  reasoningEffort: 'low' | 'medium' | 'high'
}

export type AnalysisTurn = {
  id: number
  prompt: string
  response: string
  status: 'complete' | 'interrupted'
  settings: Omit<AnalysisSettings, 'apiKey'>
}
