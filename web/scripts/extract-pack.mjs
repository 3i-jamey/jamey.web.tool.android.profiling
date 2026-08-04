import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const [baselineZip, candidateZip, outPath] = process.argv.slice(2)
if (!baselineZip || !candidateZip || !outPath) {
  console.error('usage: node extract-pack.mjs <baseline.zip> <candidate.zip> <out.json>')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } })

let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: chrome, headless: true })
  const page = await browser.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('server URL unavailable')
  await page.goto(url, { waitUntil: 'networkidle' })
  const inputs = page.locator('input[type=file][accept*=".zip"]')
  await inputs.nth(0).setInputFiles(resolve(baselineZip))
  await inputs.nth(1).setInputFiles(resolve(candidateZip))
  await page.getByRole('button', { name: '캡처 추출 및 비교' }).click()
  const outcome = await Promise.race([
    page.getByText('결정적 비교표').waitFor({ timeout: 300_000 }).then(() => 'ready'),
    page.locator('.error-box').waitFor({ timeout: 300_000 }).then(() => 'error'),
  ])
  if (outcome === 'error') {
    const errorText = await page.locator('.error-box').textContent()
    throw new Error(`UI error: ${errorText}\nBrowser errors: ${browserErrors.join(' | ')}`)
  }
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'fact-pack.json' }).click()
  const download = await downloadPromise
  const path = await download.path()
  await writeFile(outPath, await readFile(path))
  console.log(`fact pack written: ${outPath}`)
} finally {
  await browser?.close()
  await server.close()
}
