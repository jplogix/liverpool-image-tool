import { AlertTriangle, CheckCircle2, FileArchive, Loader2, Upload } from 'lucide-react'
import Papa from 'papaparse'
import type { ParseResult } from 'papaparse'
import { useEffect, useMemo, useState } from 'react'

import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'

const FRAME_WIDTH = 940
const FRAME_HEIGHT = 1215
const HORIZONTAL_PADDING = 10
const OUTPUT_MIME_TYPE = 'image/jpeg'
const OUTPUT_QUALITY = 0.95
const SOFT_ROW_LIMIT = 500
const WARNING_ROW_LIMIT = 750
const HARD_ROW_LIMIT = 1000

type CsvRecord = Record<string, string>

type ParsedCsv = {
  headers: string[]
  rows: CsvRecord[]
  warnings: string[]
}

type ColumnMapping = {
  skuColumn: string
  frontColumn: string
  angledColumn: string
}

type OutputImage = {
  label: '1' | '2' | '3'
  filename: string
  previewUrl: string
  blob: Blob
}

type ProcessedRow = {
  sku: string
  outputs: OutputImage[]
  errors: string[]
}

type ZipFile = {
  name: string
  data: Uint8Array
}

const crcTable = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  crcTable[index] = value >>> 0
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim()
}

function normalizeForMatch(value: string): string {
  return normalizeHeader(value).toLowerCase()
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function sanitizeFileName(value: string): string {
  const cleaned = value
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || 'image'
}

function cleanRow(row: Record<string, string>, headers: string[]): CsvRecord {
  const nextRow: CsvRecord = {}

  Object.entries(row).forEach(([rawKey, value]) => {
    const key = normalizeHeader(rawKey)
    if (headers.includes(key)) {
      nextRow[key] = (value ?? '').trim()
    }
  })

  return nextRow
}

function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (results: ParseResult<Record<string, string>>) => {
        const headers = Array.from(
          new Set((results.meta.fields ?? []).map(normalizeHeader).filter(Boolean)),
        )

        if (headers.length === 0) {
          resolve({ headers: [], rows: [], warnings: ['CSV has no header row.'] })
          return
        }

        const rows = results.data
          .map((row) => cleanRow(row, headers))
          .filter((row) => headers.some((header) => row[header]?.trim()))

        resolve({
          headers,
          rows,
          warnings: results.errors.map((error) => `Row ${error.row ?? '?'}: ${error.message}`),
        })
      },
      error: (error: Error) => reject(error),
    })
  })
}

function firstMatchingHeader(headers: string[], candidates: string[]): string {
  const normalizedCandidates = candidates.map((candidate) => candidate.toLowerCase())
  return (
    headers.find((header) => normalizedCandidates.includes(normalizeForMatch(header))) ??
    headers.find((header) =>
      normalizedCandidates.some((candidate) => normalizeForMatch(header).includes(candidate)),
    ) ??
    ''
  )
}

function firstUrlHeader(headers: string[], rows: CsvRecord[], excluded = new Set<string>()): string {
  return (
    headers.find((header) => {
      if (excluded.has(header)) {
        return false
      }

      return rows.some((row) => isValidUrl(row[header] ?? ''))
    }) ?? ''
  )
}

function inferMapping(headers: string[], rows: CsvRecord[]): ColumnMapping {
  const skuColumn =
    firstMatchingHeader(headers, ['skui', 'sku', 'product sku', 'item sku', 'id', 'product id']) ??
    headers[0] ??
    ''

  const frontColumn =
    firstMatchingHeader(headers, [
      'img2',
      'front',
      'front image',
      'main',
      'main image',
      'default',
      'default image',
    ]) || firstUrlHeader(headers, rows, new Set([skuColumn]))

  const angledColumn =
    firstMatchingHeader(headers, ['img1', 'angle', 'angled', 'angle image', 'side']) ||
    firstUrlHeader(headers, rows, new Set([skuColumn, frontColumn]))

  return { skuColumn, frontColumn, angledColumn }
}

function proxyImageUrl(url: string): string {
  return `/image-proxy?url=${encodeURIComponent(url)}`
}

function loadImage(url: string, timeoutMs = 20000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'

    const timeout = window.setTimeout(() => {
      reject(new Error(`Timed out loading ${url}`))
    }, timeoutMs)

    image.onload = () => {
      window.clearTimeout(timeout)
      resolve(image)
    }

    image.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error(`Could not load image: ${url}`))
    }

    image.src = proxyImageUrl(url)
  })
}

function renderFramedImage(image: HTMLImageElement, flipX = false): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = FRAME_WIDTH
  canvas.height = FRAME_HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not initialize drawing context.')
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT)

  const availableWidth = FRAME_WIDTH - HORIZONTAL_PADDING * 2
  const scale = Math.min(availableWidth / image.naturalWidth, FRAME_HEIGHT / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  const drawX = (FRAME_WIDTH - drawWidth) / 2
  const drawY = (FRAME_HEIGHT - drawHeight) / 2

  if (flipX) {
    ctx.save()
    ctx.translate(FRAME_WIDTH, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
    ctx.restore()
  } else {
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not export canvas.'))
          return
        }
        resolve(blob)
      },
      OUTPUT_MIME_TYPE,
      OUTPUT_QUALITY,
    )
  })
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true)
}

function createZip(files: ZipFile[]): Blob {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const centralDirectory: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const checksum = crc32(file.data)
    const localHeader = new Uint8Array(30 + name.length)
    const localView = new DataView(localHeader.buffer)

    writeUint32(localView, 0, 0x04034b50)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0)
    writeUint16(localView, 8, 0)
    writeUint16(localView, 10, 0)
    writeUint16(localView, 12, 0)
    writeUint32(localView, 14, checksum)
    writeUint32(localView, 18, file.data.length)
    writeUint32(localView, 22, file.data.length)
    writeUint16(localView, 26, name.length)
    writeUint16(localView, 28, 0)
    localHeader.set(name, 30)
    chunks.push(localHeader, file.data)

    const centralHeader = new Uint8Array(46 + name.length)
    const centralView = new DataView(centralHeader.buffer)
    writeUint32(centralView, 0, 0x02014b50)
    writeUint16(centralView, 4, 20)
    writeUint16(centralView, 6, 20)
    writeUint16(centralView, 8, 0)
    writeUint16(centralView, 10, 0)
    writeUint16(centralView, 12, 0)
    writeUint16(centralView, 14, 0)
    writeUint32(centralView, 16, checksum)
    writeUint32(centralView, 20, file.data.length)
    writeUint32(centralView, 24, file.data.length)
    writeUint16(centralView, 28, name.length)
    writeUint16(centralView, 30, 0)
    writeUint16(centralView, 32, 0)
    writeUint16(centralView, 34, 0)
    writeUint16(centralView, 36, 0)
    writeUint32(centralView, 38, 0)
    writeUint32(centralView, 42, offset)
    centralHeader.set(name, 46)
    centralDirectory.push(centralHeader)

    offset += localHeader.length + file.data.length
  }

  const centralOffset = offset
  const centralSize = centralDirectory.reduce((total, chunk) => total + chunk.length, 0)
  chunks.push(...centralDirectory)

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, files.length)
  writeUint16(endView, 10, files.length)
  writeUint32(endView, 12, centralSize)
  writeUint32(endView, 16, centralOffset)
  writeUint16(endView, 20, 0)
  chunks.push(end)

  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const zipData = new Uint8Array(totalLength)
  let cursor = 0

  for (const chunk of chunks) {
    zipData.set(chunk, cursor)
    cursor += chunk.length
  }

  return new Blob([zipData.buffer], { type: 'application/zip' })
}

function App() {
  const [headers, setHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<CsvRecord[]>([])
  const [csvWarnings, setCsvWarnings] = useState<string[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({
    skuColumn: '',
    frontColumn: '',
    angledColumn: '',
  })
  const [selectedFileName, setSelectedFileName] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [processedRows, setProcessedRows] = useState<ProcessedRow[]>([])
  const [zipUrl, setZipUrl] = useState('')

  const selectedColumnsReady = Boolean(
    mapping.skuColumn && mapping.frontColumn && mapping.angledColumn,
  )

  const validRows = useMemo(() => {
    if (!selectedColumnsReady) {
      return []
    }

    return csvRows.filter((row) => {
      const sku = row[mapping.skuColumn]?.trim()
      const frontUrl = row[mapping.frontColumn]?.trim()
      const angledUrl = row[mapping.angledColumn]?.trim()
      return sku && (isValidUrl(frontUrl) || isValidUrl(angledUrl))
    })
  }, [csvRows, mapping, selectedColumnsReady])

  const generatedCount = useMemo(() => {
    return processedRows.reduce((total, row) => total + row.outputs.length, 0)
  }, [processedRows])

  const exceedsHardLimit = csvRows.length > HARD_ROW_LIMIT
  const shouldWarnAboutRows = csvRows.length > SOFT_ROW_LIMIT && csvRows.length <= HARD_ROW_LIMIT
  const canGenerate =
    selectedColumnsReady && validRows.length > 0 && !isProcessing && !exceedsHardLimit

  useEffect(() => {
    return () => {
      processedRows.forEach((row) => {
        row.outputs.forEach((output) => URL.revokeObjectURL(output.previewUrl))
      })
      if (zipUrl) {
        URL.revokeObjectURL(zipUrl)
      }
    }
  }, [processedRows, zipUrl])

  function resetOutputs() {
    processedRows.forEach((row) => {
      row.outputs.forEach((output) => URL.revokeObjectURL(output.previewUrl))
    })
    if (zipUrl) {
      URL.revokeObjectURL(zipUrl)
    }
    setProcessedRows([])
    setZipUrl('')
  }

  async function handleCsvUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setGlobalError('')
    resetOutputs()
    setSelectedFileName(file.name)

    try {
      const parsed = await parseCsvFile(file)
      setHeaders(parsed.headers)
      setCsvRows(parsed.rows)
      setCsvWarnings(parsed.warnings)
      setMapping(inferMapping(parsed.headers, parsed.rows))
    } catch {
      setHeaders([])
      setCsvRows([])
      setCsvWarnings([])
      setMapping({ skuColumn: '', frontColumn: '', angledColumn: '' })
      setGlobalError('Failed to parse CSV file. Please check the file format and try again.')
    }
  }

  function updateMapping(key: keyof ColumnMapping, value: string) {
    resetOutputs()
    setMapping((current) => ({ ...current, [key]: value }))
  }

  async function generateZip() {
    if (!canGenerate) {
      if (exceedsHardLimit) {
        setGlobalError(
          `This file has ${csvRows.length} rows. Split it into files of ${HARD_ROW_LIMIT} rows or fewer.`,
        )
      }
      return
    }

    setIsProcessing(true)
    setGlobalError('')
    resetOutputs()

    const imageCache = new Map<string, Promise<HTMLImageElement>>()
    const getImage = (url: string) => {
      const cached = imageCache.get(url)
      if (cached) {
        return cached
      }

      const pending = loadImage(url)
      imageCache.set(url, pending)
      return pending
    }

    const nextResults: ProcessedRow[] = []
    const zipFiles: ZipFile[] = []

    for (const [index, row] of csvRows.entries()) {
      const rowNumber = index + 2
      const sku = row[mapping.skuColumn]?.trim()
      const frontUrl = row[mapping.frontColumn]?.trim()
      const angledUrl = row[mapping.angledColumn]?.trim()

      if (!sku && !frontUrl && !angledUrl) {
        continue
      }

      const errors: string[] = []
      const outputs: OutputImage[] = []
      const filenameBase = sanitizeFileName(sku)

      if (!sku) {
        errors.push(`Row ${rowNumber}: SKU column is blank.`)
      }

      if (frontUrl && !isValidUrl(frontUrl)) {
        errors.push(`Row ${rowNumber}: front image URL is invalid.`)
      } else if (frontUrl) {
        try {
          const frontImage = await getImage(frontUrl)
          const frontBlob = await renderFramedImage(frontImage, false)
          outputs.push({
            label: '1',
            filename: `${filenameBase}-1.jpg`,
            previewUrl: URL.createObjectURL(frontBlob),
            blob: frontBlob,
          })
        } catch (error) {
          errors.push(
            `Row ${rowNumber}: Front image error - ${error instanceof Error ? error.message : 'Processing failed'}.`,
          )
        }
      }

      if (angledUrl && !isValidUrl(angledUrl)) {
        errors.push(`Row ${rowNumber}: angled image URL is invalid.`)
      } else if (angledUrl) {
        try {
          const angledImage = await getImage(angledUrl)
          const angledBlob = await renderFramedImage(angledImage, false)
          const flippedBlob = await renderFramedImage(angledImage, true)
          outputs.push(
            {
              label: '2',
              filename: `${filenameBase}-2.jpg`,
              previewUrl: URL.createObjectURL(angledBlob),
              blob: angledBlob,
            },
            {
              label: '3',
              filename: `${filenameBase}-3.jpg`,
              previewUrl: URL.createObjectURL(flippedBlob),
              blob: flippedBlob,
            },
          )
        } catch (error) {
          errors.push(
            `Row ${rowNumber}: Angled image error - ${error instanceof Error ? error.message : 'Processing failed'}.`,
          )
        }
      }

      outputs.sort((a, b) => Number(a.label) - Number(b.label))
      nextResults.push({ sku: sku || `Row ${rowNumber}`, outputs, errors })

      for (const output of outputs) {
        zipFiles.push({
          name: output.filename,
          data: new Uint8Array(await output.blob.arrayBuffer()),
        })
      }
    }

    if (zipFiles.length === 0) {
      setGlobalError('No images were generated. Check the selected columns and image URLs.')
    } else {
      setZipUrl(URL.createObjectURL(createZip(zipFiles)))
    }

    setProcessedRows(nextResults)
    setIsProcessing(false)
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-12 md:px-8">
      <header className="space-y-4">
        <div className="inline-flex items-center rounded-full bg-[hsl(var(--primary)/0.1)] px-3 py-1 text-xs font-medium text-[hsl(var(--primary))] ring-1 ring-inset ring-[hsl(var(--primary)/0.2)]">
          v1.2.0 • Image Pipeline Fixed
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight md:text-6xl text-[hsl(var(--foreground))]">
          Product Image Zip Builder
        </h1>
        <p className="max-w-3xl text-base text-[hsl(var(--muted-foreground))] md:text-lg leading-relaxed">
          Upload any CSV, choose the SKU, front-facing image, and angled image columns, then export
          a zip of 940x1215 JPGs named SKU-1, SKU-2, and SKU-3.
        </p>
        <div className="flex flex-wrap gap-4 pt-2">
          <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Recommended: {SOFT_ROW_LIMIT} rows
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Warning: {WARNING_ROW_LIMIT} rows
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            Hard Limit: {HARD_ROW_LIMIT} rows
          </div>
        </div>
      </header>

      <section className="grid gap-8 md:grid-cols-5">
        <Card className="md:col-span-3 overflow-hidden border-none shadow-2xl shadow-black/5 ring-1 ring-black/5">
          <CardHeader className="bg-linear-to-r from-[hsl(var(--muted)/0.5)] to-transparent border-b">
            <CardTitle className="flex items-center gap-2 text-xl font-bold">
              <Upload className="h-5 w-5 text-[hsl(var(--primary))]" />
              CSV Input
            </CardTitle>
            <CardDescription>Defaults are inferred, but every column can be changed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-3">
              <Label htmlFor="csv-upload" className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                CSV file
              </Label>
              <div className="relative group">
                <Input 
                  id="csv-upload" 
                  type="file" 
                  accept=".csv,text/csv" 
                  onChange={handleCsvUpload}
                  className="cursor-pointer bg-[hsl(var(--muted)/0.3)] border-dashed border-2 hover:border-[hsl(var(--primary))] transition-colors duration-200"
                />
              </div>
              {selectedFileName ? (
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Loaded: {selectedFileName}
                </div>
              ) : null}
            </div>

            {headers.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="sku-column" className="text-xs font-bold uppercase text-[hsl(var(--muted-foreground))]">
                    SKU/name column
                  </Label>
                  <select
                    id="sku-column"
                    value={mapping.skuColumn}
                    onChange={(event) => updateMapping('skuColumn', event.target.value)}
                    className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-white px-3 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[hsl(var(--primary))] focus:border-transparent"
                  >
                    <option value="">Choose column</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="front-column" className="text-xs font-bold uppercase text-[hsl(var(--muted-foreground))]">
                    Front-facing image
                  </Label>
                  <select
                    id="front-column"
                    value={mapping.frontColumn}
                    onChange={(event) => updateMapping('frontColumn', event.target.value)}
                    className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-white px-3 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[hsl(var(--primary))] focus:border-transparent"
                  >
                    <option value="">Choose column</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Exports as SKU-1.jpg</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="angled-column" className="text-xs font-bold uppercase text-[hsl(var(--muted-foreground))]">
                    Angled image
                  </Label>
                  <select
                    id="angled-column"
                    value={mapping.angledColumn}
                    onChange={(event) => updateMapping('angledColumn', event.target.value)}
                    className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-white px-3 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[hsl(var(--primary))] focus:border-transparent"
                  >
                    <option value="">Choose column</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                    Exports as SKU-2 & SKU-3 (flipped)
                  </p>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 sm:flex-row pt-4">
              <Button 
                onClick={generateZip} 
                disabled={!canGenerate} 
                className="h-12 w-full sm:w-auto px-8 rounded-xl font-bold shadow-lg shadow-[hsl(var(--primary)/0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Building zip...
                  </>
                ) : (
                  <>
                    <FileArchive className="mr-2 h-5 w-5" />
                    Generate Zip
                  </>
                )}
              </Button>

              {zipUrl ? (
                <Button 
                  variant="outline" 
                  asChild 
                  className="h-12 w-full sm:w-auto px-8 rounded-xl font-bold border-2 hover:bg-[hsl(var(--primary)/0.05)] transition-all"
                >
                  <a href={zipUrl} download="product-images.zip">
                    <CheckCircle2 className="mr-2 h-5 w-5 text-emerald-500" />
                    Download Zip
                  </a>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-none shadow-2xl shadow-black/5 ring-1 ring-black/5 bg-[hsl(var(--primary)/0.02)]">
          <CardHeader>
            <CardTitle className="text-xl font-bold">Status</CardTitle>
            <CardDescription>Generation details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: 'CSV rows', value: csvRows.length },
              { label: 'Usable rows', value: validRows.length },
              { label: 'Generated', value: generatedCount, highlight: true },
              { label: 'Frame size', value: '940x1215 px' },
              { label: 'Output', value: 'JPG zip' },
            ].map((stat) => (
              <div key={stat.label} className="flex justify-between items-center py-1 border-b border-[hsl(var(--border)/0.5)] last:border-0">
                <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{stat.label}</span>
                <span className={`text-sm font-bold ${stat.highlight ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'}`}>
                  {stat.value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {(shouldWarnAboutRows || exceedsHardLimit || globalError) && (
        <div className="space-y-4">
          {shouldWarnAboutRows && (
            <Card className="border-none bg-amber-50 ring-1 ring-amber-200">
              <CardContent className="flex items-start gap-4 p-5 text-amber-900">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p className="font-bold">Large File Warning</p>
                  <p className="text-sm leading-relaxed opacity-90">
                    This CSV has {csvRows.length} rows. Processing may be slow and use significant memory.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {exceedsHardLimit && (
            <Card className="border-none bg-red-50 ring-1 ring-red-200">
              <CardContent className="flex items-start gap-4 p-5 text-red-900">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
                <div className="space-y-1">
                  <p className="font-bold">Hard Limit Exceeded</p>
                  <p className="text-sm leading-relaxed opacity-90">
                    Maximum {HARD_ROW_LIMIT} rows allowed. Please split your file.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {globalError && (
            <Card className="border-none bg-red-50 ring-1 ring-red-200 animate-in fade-in zoom-in duration-300">
              <CardContent className="flex items-start gap-4 p-5 text-red-900">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
                <p className="font-medium">{globalError}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {csvWarnings.length > 0 && (
        <Card className="border-none bg-[hsl(var(--muted)/0.3)] ring-1 ring-black/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              CSV Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 list-inside list-disc text-sm text-[hsl(var(--muted-foreground))]">
              {csvWarnings.slice(0, 10).map((warning) => (
                <li key={warning} className="truncate" title={warning}>{warning}</li>
              ))}
              {csvWarnings.length > 10 && (
                <li className="font-medium text-[hsl(var(--primary))]">+ {csvWarnings.length - 10} more warnings</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {processedRows.length > 0 && (
        <section className="space-y-8 pb-12 pt-4">
          <div className="flex items-center justify-between border-b pb-4">
            <h2 className="text-3xl font-black tracking-tight">Generated Preview</h2>
            <div className="text-sm font-bold text-[hsl(var(--muted-foreground))]">
              {processedRows.length} Products Processed
            </div>
          </div>
          <div className="grid gap-10">
            {processedRows.map((row) => (
              <div 
                key={`${row.sku}-${row.outputs.map((o) => o.filename).join('-')}`}
                className="group relative"
              >
                <div className="mb-6 flex items-center gap-4">
                  <div className="flex h-12 items-center rounded-2xl bg-[hsl(var(--foreground))] px-6 text-xl font-black text-[hsl(var(--background))] shadow-xl transition-transform group-hover:scale-[1.02]">
                    {row.sku}
                  </div>
                  {row.errors.length > 0 ? (
                    <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700 ring-1 ring-red-200">
                      <AlertTriangle className="h-4 w-4" />
                      {row.errors.length} Errors Found
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                      <CheckCircle2 className="h-4 w-4" />
                      Ready for Export
                    </div>
                  )}
                </div>

                {row.errors.length > 0 && (
                  <div className="mb-6 space-y-2 rounded-2xl bg-red-50/50 p-4 ring-1 ring-red-100">
                    {row.errors.map((error, idx) => (
                      <p key={idx} className="text-xs font-medium text-red-800 flex items-center gap-2">
                        <span className="h-1 w-1 rounded-full bg-red-400" />
                        {error}
                      </p>
                    ))}
                  </div>
                )}

                {row.outputs.length > 0 && (
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
                    {row.outputs.map((output) => (
                      <div
                        key={output.filename}
                        className="group/item relative overflow-hidden rounded-3xl bg-white p-4 shadow-xl ring-1 ring-black/3 transition-all hover:shadow-2xl hover:ring-[hsl(var(--primary)/0.2)]"
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-sm font-black text-white shadow-lg shadow-[hsl(var(--primary)/0.3)]">
                            {output.label}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                            Output Image
                          </span>
                        </div>
                        <div className="aspect-940/1215 relative overflow-hidden rounded-2xl bg-[hsl(var(--muted)/0.3)] border shadow-inner">
                          <img
                            src={output.previewUrl}
                            alt={`${row.sku} output ${output.label}`}
                            className="h-full w-full object-contain transition-transform duration-500 group-hover/item:scale-110"
                          />
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-2">
                          <p className="truncate text-[10px] font-bold uppercase tracking-tighter text-[hsl(var(--muted-foreground))]">
                            {output.filename}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Visual Separator */}
                <div className="mt-10 h-px w-full bg-linear-to-r from-transparent via-[hsl(var(--border))] to-transparent opacity-50" />
              </div>
            ))}
          </div>
        </section>
      )}



    </main>
  )
}


export default App
