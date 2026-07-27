import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '..')
const repository = resolve(root, '..')
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } })

function item(pack, key) {
  for (const section of Object.values(pack.sections)) {
    const match = [...section.items, ...section.onlyInBaseline, ...section.onlyInCandidate]
      .find((candidate) => candidate.key === key)
    if (match) return match
  }
  const sectionName = key.split('.')[0]
  const available = pack.sections[sectionName]
    ? [...pack.sections[sectionName].items, ...pack.sections[sectionName].onlyInBaseline, ...pack.sections[sectionName].onlyInCandidate]
      .filter((entry) => entry.label.toLowerCase().includes(key.split('.')[1]?.toLowerCase() ?? ''))
      .map((entry) => entry.key)
    : []
  throw new Error(`fact key 없음: ${key}; related=${JSON.stringify(available)}`)
}

function closeTo(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} ± ${tolerance}, got ${actual}`)
  }
}

let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: chrome, headless: true })
  const page = await browser.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  const verificationUrl = server.resolvedUrls?.local[0]
  if (!verificationUrl) throw new Error('verification server URL unavailable')
  await page.goto(verificationUrl, { waitUntil: 'networkidle' })
  const modelSelect = page.getByLabel('Model')
  await modelSelect.selectOption('gpt-5.6-sol')
  await page.getByLabel('Reasoning').selectOption('medium')
  if (await modelSelect.inputValue() !== 'gpt-5.6-sol' || await page.getByLabel('Reasoning').inputValue() !== 'medium') {
    throw new Error('model or reasoning selection did not update')
  }
  const initialPrompt = 'operation 실행 횟수와 함수 CPU 변화를 우선 분석해 주세요.'
  await page.getByLabel('첫 분석 요청').fill(initialPrompt)
  const inputs = page.locator('input[type=file][accept*=".zip"]')
  await inputs.nth(0).setInputFiles(resolve(repository, '20260723-175550.zip'))
  await inputs.nth(1).setInputFiles(resolve(repository, '20260723-201509.zip'))
  await page.getByRole('button', { name: '캡처 추출 및 비교' }).click()
  const outcome = await Promise.race([
    page.getByText('결정적 비교표').waitFor({ timeout: 120_000 }).then(() => 'ready'),
    page.locator('.error-box').waitFor({ timeout: 120_000 }).then(() => 'error'),
  ])
  if (outcome === 'error') {
    const errorText = await page.locator('.error-box').textContent()
    throw new Error(`UI error: ${errorText}\nBrowser errors: ${browserErrors.join(' | ')}`)
  }
  if (await page.getByLabel('첫 분석 요청').inputValue() !== initialPrompt) {
    throw new Error('initial prompt was not preserved through extraction')
  }

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'fact-pack.json' }).click()
  const download = await downloadPromise
  const path = await download.path()
  const pack = JSON.parse(await readFile(path, 'utf8'))

  for (const sectionName of ['processes', 'threads', 'cpuByCore', 'threadStates', 'cpuFrequency', 'slices', 'frames', 'memory', 'gc', 'binder', 'perfSummary', 'perfThreads', 'perfSymbols', 'perfStacks', 'perfFunctions', 'perfFunctionsByThread']) {
    const section = pack.sections[sectionName]
    if (!section?.available.baseline || !section?.available.candidate) {
      throw new Error(`${sectionName} unavailable: ${JSON.stringify(section?.reason)}`)
    }
  }

  closeTo(pack.baseline.traceBounds.durationNs, 10.0014e9, 2e6, 'baseline trace duration')
  closeTo(pack.candidate.traceBounds.durationNs, 10.0048e9, 2e6, 'candidate trace duration')
  closeTo(pack.baseline.bounds.durationNs, 1000e6, 0, 'baseline analysis window')
  closeTo(pack.candidate.bounds.durationNs, 1000e6, 0, 'candidate analysis window')
  if (pack.baseline.window.source !== 'actual_frame_timeline'
    || pack.candidate.window.source !== 'actual_frame_timeline') {
    throw new Error(`unexpected analysis window sources: ${pack.baseline.window.source}, ${pack.candidate.window.source}`)
  }
  if (pack.baseline.window.selection !== 'representative' || pack.candidate.window.selection !== 'matched') {
    throw new Error('analysis window selection modes are incorrect')
  }
  if (!Number.isFinite(pack.candidate.window.similarityScore)) throw new Error('candidate similarity score is invalid')
  if (item(pack, 'processes.app_pivo_android_capture_dev.cpuTimeNs').baseline <= 0) {
    throw new Error('selected baseline window has no target CPU time')
  }
  if (pack.baseline.window.profile.markerCount <= 0 || pack.candidate.window.profile.markerCount <= 0) {
    throw new Error('selected windows do not contain FrameTimeline cadence')
  }
  const operationCounts = [
    ...pack.sections.slices.items,
    ...pack.sections.slices.onlyInBaseline,
    ...pack.sections.slices.onlyInCandidate,
  ].filter((entry) => entry.metric === 'executionCount')
  if (!operationCounts.length || !operationCounts.some((entry) => (entry.baseline ?? 0) > 0)
    || !operationCounts.some((entry) => (entry.candidate ?? 0) > 0)) {
    throw new Error('operation execution counts were not extracted')
  }
  if (item(pack, 'perfSummary.all.sampleCount').baseline <= 0
    || item(pack, 'perfSummary.all.sampleCount').candidate <= 0) {
    throw new Error('selected windows do not contain perf samples')
  }
  if (pack.budget.maxBytes !== 1_000_000 || pack.budget.byteLength > pack.budget.maxBytes) {
    throw new Error(`fact pack budget is invalid: ${JSON.stringify(pack.budget)}`)
  }
  const stackItems = [
    ...pack.sections.perfStacks.items,
    ...pack.sections.perfStacks.onlyInBaseline,
    ...pack.sections.perfStacks.onlyInCandidate,
  ]
  if (!stackItems.length || !stackItems.some((stack) => stack.label.includes(' > '))) {
    throw new Error('full perf stack paths were not included in the fact pack')
  }
  if (stackItems.some((stack) => !stack.key.startsWith('perfStacks.stack_'))) {
    throw new Error('perf stack citation keys are not compact deterministic hashes')
  }
  const inspectSymbol = process.env.INSPECT_SYMBOL?.toLowerCase()
  if (inspectSymbol) {
    const matches = Object.entries(pack.sections).flatMap(([sectionName, section]) =>
      [...section.items, ...section.onlyInBaseline, ...section.onlyInCandidate]
        .filter((entry) => entry.label.toLowerCase().includes(inspectSymbol))
        .map((entry) => ({ section: sectionName, ...entry })),
    )
    console.log(JSON.stringify({ inspectSymbol, matches }, null, 2))
  }
  if (browserErrors.length) throw new Error(`브라우저 오류: ${browserErrors.join(' | ')}`)
  console.log(`sample verification passed (${pack.budget.byteLength} byte fact pack)`)
} finally {
  await browser?.close()
  await server.close()
}
