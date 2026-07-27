import { useRef, useState, type DragEvent } from 'react'
import { inspectArchive, type InspectedArchive } from '../archive'

type Props = {
  label: string
  tone: 'baseline' | 'candidate'
  archive?: InspectedArchive
  selectedEntry?: string
  disabled?: boolean
  onChange: (archive: InspectedArchive, entry: string) => void
  onError: (message: string) => void
}

export function CaptureInput({ label, tone, archive, selectedEntry, disabled, onChange, onError }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const inspect = async (file?: File) => {
    if (!file) return
    setLoading(true)
    try {
      const next = await inspectArchive(file)
      onChange(next, next.candidates[0].name)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void inspect(event.dataTransfer.files[0])
  }

  return (
    <div
      className={`capture-input ${tone} ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <div className="capture-heading">
        <span className="capture-marker" />
        <div>
          <span className="eyebrow">{tone === 'baseline' ? 'BEFORE' : 'AFTER'}</span>
          <h3>{label}</h3>
        </div>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept=".zip,application/zip"
        disabled={disabled}
        onChange={(event) => void inspect(event.target.files?.[0])}
      />
      {archive ? (
        <div className="capture-file">
          <strong>{archive.file.name}</strong>
          <span>{(archive.file.size / 1024 / 1024).toFixed(1)} MB</span>
          {archive.candidates.length > 1 ? (
            <label>
              Trace 선택
              <select value={selectedEntry} onChange={(event) => onChange(archive, event.target.value)}>
                {archive.candidates.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>{candidate.name}</option>
                ))}
              </select>
            </label>
          ) : <code>{selectedEntry}</code>}
          <button className="text-button" type="button" disabled={disabled} onClick={() => input.current?.click()}>
            다른 ZIP
          </button>
        </div>
      ) : (
        <button className="drop-action" type="button" disabled={disabled || loading} onClick={() => input.current?.click()}>
          <span className="drop-plus">+</span>
          <strong>{loading ? 'ZIP 확인 중' : 'ZIP을 놓거나 선택'}</strong>
          <small>원본은 브라우저 밖으로 나가지 않습니다</small>
        </button>
      )}
    </div>
  )
}
