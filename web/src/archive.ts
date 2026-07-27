import {
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js'
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_TRACE_BYTES,
  MAX_UNCOMPRESSED_BYTES,
} from './constants'

const TRACE_EXTENSIONS = ['.perfetto-trace', '.pftrace', '.trace']

export type TraceCandidate = {
  name: string
  uncompressedSize: number
}

export type InspectedArchive = {
  file: File
  candidates: TraceCandidate[]
  configText?: string
  metadataText?: string
}

function ignored(name: string) {
  return name.startsWith('__MACOSX/') || name.endsWith('/.DS_Store') || name === '.DS_Store'
}

export function isTraceCandidate(name: string, size: number) {
  const lower = name.toLowerCase()
  const leaf = lower.split('/').at(-1) ?? lower
  return TRACE_EXTENSIONS.some((extension) => leaf.endsWith(extension)) || (!leaf.includes('.') && size >= 1024 * 1024)
}

async function withEntries<T>(file: File, action: (entries: FileEntry[]) => Promise<T>) {
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: true })
  try {
    const entries = await reader.getEntries()
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`ZIP 항목이 ${MAX_ARCHIVE_ENTRIES.toLocaleString()}개를 초과합니다.`)
    }
    const totalSize = entries.reduce((sum, entry) => sum + (entry.uncompressedSize || 0), 0)
    if (totalSize > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('압축 해제 크기가 1GB 제한을 초과합니다.')
    }
    const files = entries.filter((entry): entry is FileEntry => !entry.directory && !ignored(entry.filename))
    return await action(files)
  } finally {
    await reader.close()
  }
}

async function entryText(entry: FileEntry) {
  return entry.getData(new TextWriter())
}

export async function inspectArchive(file: File): Promise<InspectedArchive> {
  return withEntries(file, async (entries) => {
    const candidates = entries
      .filter((entry) => isTraceCandidate(entry.filename, entry.uncompressedSize))
      .map((entry) => ({ name: entry.filename, uncompressedSize: entry.uncompressedSize }))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (candidates.length === 0) throw new Error('ZIP에서 Perfetto trace 후보를 찾지 못했습니다.')
    if (candidates.some((candidate) => candidate.uncompressedSize > MAX_TRACE_BYTES)) {
      throw new Error('trace가 브라우저 처리 제한 512MB를 초과합니다.')
    }

    const configEntry = entries.find((entry) => entry.filename.toLowerCase().endsWith('/config.textproto'))
      ?? entries.find((entry) => entry.filename.toLowerCase() === 'config.textproto')
    const metadataEntry = entries.find((entry) => entry.filename.toLowerCase().endsWith('/metadata.txt'))
      ?? entries.find((entry) => entry.filename.toLowerCase() === 'metadata.txt')

    return {
      file,
      candidates,
      configText: configEntry ? await entryText(configEntry) : undefined,
      metadataText: metadataEntry ? await entryText(metadataEntry) : undefined,
    }
  })
}

export async function extractTrace(archive: InspectedArchive, traceEntry: string) {
  return withEntries(archive.file, async (entries) => {
    const entry = entries.find((candidate) => candidate.filename === traceEntry)
    if (!entry) throw new Error(`trace 항목을 다시 찾지 못했습니다: ${traceEntry}`)
    const bytes = await entry.getData(new Uint8ArrayWriter())
    if (bytes.byteLength === 0) throw new Error('trace가 비어 있습니다.')
    return bytes
  })
}

export function parseMetadata(text?: string) {
  if (!text) return {}
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf('=')
      return separator > 0 ? [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]] : []
    }),
  )
}
