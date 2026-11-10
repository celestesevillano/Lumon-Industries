import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../lib/api'
import {
  BINS, BIN_CHAR, getFile, getRules, readProgress, refine,
  type BinCode, type FileDetail, type Rules,
} from '../lib/files'
import { findGroup, type Group } from '../lib/groups'
import { TileStore } from '../lib/tiles'

const CELL = 28
// 38 filas x 60 columnas (+1 fila y +1 columna por la celda con foco) = 2 379 < 2 500 celdas en el DOM.
const MAX_ROWS = 38
const MAX_COLS = 60
const OVERSCAN = 2
const BIN_STYLE: Record<string, string> = {
  W: 'bg-sky-300 text-sky-950', F: 'bg-amber-300 text-amber-950',
  D: 'bg-rose-300 text-rose-950', M: 'bg-violet-300 text-violet-950',
}

type Selection =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; group: Group }

interface View { top: number; left: number; h: number; w: number }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export default function RefinePage() {
  const { id = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const [file, setFile] = useState<FileDetail | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [store, setStore] = useState<TileStore | null>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [view, setView] = useState<View>({ top: 0, left: 0, h: 600, w: 900 })
  const [focus, setFocus] = useState({ r: clamp(parseInt(sp.get('r') ?? '', 10) || 0, 0, 1e6), c: clamp(parseInt(sp.get('c') ?? '', 10) || 0, 0, 1e6) })
  const [sel, setSel] = useState<Selection | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const selToken = useRef(0)
  const submitting = useRef(false)
  const intent = useRef<{ sig: string; key: string } | null>(null)
  const initialScroll = useRef(true)

  // Carga del archivo y de sus reglas (las reglas cambian por archivo: nunca se escriben a mano).
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getFile(id, controller.signal), getRules(id, controller.signal)])
      .then(([f, r]) => { setFile(f); setRules(r); setStore(new TileStore(id, f.tileSize)) })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setLoadError(e instanceof ApiError ? e.body.message : 'No se pudo cargar el archivo.')
      })
    return () => controller.abort()
  }, [id])

  useEffect(() => store?.subscribe(bump), [store])

  // Tamaño real del viewport.
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const measure = () => setView((v) => ({ ...v, h: el.clientHeight, w: el.clientWidth }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [file])

  // La URL ?r=&c= abre la grilla en esa posición.
  useEffect(() => {
    const el = viewport.current
    if (!el || !file || !initialScroll.current) return
    initialScroll.current = false
    el.scrollTop = focus.r * CELL
    el.scrollLeft = focus.c * CELL
    setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // Rango visible (con margen) y celdas a montar.
  const rows = file?.rows ?? 0
  const cols = file?.cols ?? 0
  const startRow = clamp(Math.floor(view.top / CELL) - OVERSCAN, 0, Math.max(0, rows - 1))
  const endRow = Math.min(rows - 1, startRow + MAX_ROWS - 1, Math.ceil((view.top + view.h) / CELL) + OVERSCAN)
  const startCol = clamp(Math.floor(view.left / CELL) - OVERSCAN, 0, Math.max(0, cols - 1))
  const endCol = Math.min(cols - 1, startCol + MAX_COLS - 1, Math.ceil((view.left + view.w) / CELL) + OVERSCAN)

  // La posición se refleja en la URL sin llenar el historial.
  useEffect(() => {
    if (!file) return
    const t = setTimeout(() => {
      const next = new URLSearchParams(sp)
      next.set('r', String(Math.floor(view.top / CELL)))
      next.set('c', String(Math.floor(view.left / CELL)))
      setSp(next, { replace: true })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.top, view.left, file])

  // Bloques: se piden solo los visibles; los que salieron de la vista se cancelan.
  useEffect(() => {
    if (!store || !file) return
    const visible = new Set<string>()
    for (let tr = Math.floor(startRow / store.tileSize); tr <= Math.floor(endRow / store.tileSize); tr++) {
      for (let tc = Math.floor(startCol / store.tileSize); tc <= Math.floor(endCol / store.tileSize); tc++) {
        visible.add(TileStore.key(tr, tc))
        store.load(tr, tc).catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          setMessage({ kind: 'error', text: 'No se pudo cargar un bloque. Haz scroll de nuevo para reintentar.' })
        })
      }
    }
    store.cancelExcept(visible)
  }, [store, file, startRow, endRow, startCol, endCol])

  const selectedKeys = useMemo(() => {
    const s = new Set<string>()
    if (sel?.status === 'ready') for (const c of sel.group.cells) s.add(`${c.r},${c.c}`)
    return s
  }, [sel])

  const selectAt = useCallback(async (r: number, c: number) => {
    if (!store || !rules || !file) return
    const token = ++selToken.current
    setSel({ status: 'loading' })
    setMessage(null)
    try {
      const g = await findGroup({ r, c }, rules, file.rows, file.cols, file.tileSize, (tr, tc) => store.load(tr, tc, true))
      if (token !== selToken.current) return // una selección más nueva ganó
      if (g.size === 0) { setSel(null); setMessage({ kind: 'error', text: 'Esa celda no da miedo (o ya está refinada).' }); return }
      setSel({ status: 'ready', group: g })
    } catch {
      if (token === selToken.current) setSel({ status: 'error' })
    }
  }, [store, rules, file])

  const refreshFile = useCallback(async () => {
    try { setFile(await getFile(id)) } catch { /* el progreso se actualizará en la próxima acción */ }
  }, [id])

  const sendToBin = useCallback(async (bin: BinCode) => {
    if (!store || sel?.status !== 'ready' || submitting.current) return // doble clic / doble Enter: ignorado
    const { group } = sel
    if (group.noise || !group.bin) { setMessage({ kind: 'error', text: 'Un grupo fuera del rango es ruido: no se puede refinar.' }); return }
    if (group.bin !== bin) { setMessage({ kind: 'error', text: `La caja correcta para este grupo es ${group.bin}.` }); return }
    // Una key por intención; el reintento del mismo grupo y la misma caja reutiliza la MISMA key.
    const sig = `${group.cells[0].r},${group.cells[0].c}|${group.size}|${bin}`
    if (intent.current?.sig !== sig) intent.current = { sig, key: crypto.randomUUID() }
    submitting.current = true
    setBusy(true)
    try {
      const res = await refine(id, bin, group.cells, intent.current.key)
      store.markRefined(group.cells, BIN_CHAR[bin])
      intent.current = null
      setSel(null)
      const maybe = res.raw
      if (typeof maybe === 'object' && maybe !== null && 'progress' in maybe) setFile((f) => (f ? { ...f, progress: (maybe as { progress: unknown }).progress } : f))
      else await refreshFile()
      setMessage({ kind: 'ok', text: `Grupo de ${group.size} celdas llevado a ${bin}.` })
    } catch (e) {
      if (e instanceof ApiError && (e.status === 422 || e.status === 409)) {
        intent.current = null
        const reason = typeof e.body.details?.reason === 'string' ? ` (${e.body.details.reason})` : ''
        setMessage({ kind: 'error', text: `${e.body.message}${reason}` })
        if (e.status === 409) {
          // Alguna celda ya estaba refinada: se vuelven a pedir los bloques afectados.
          const seen = new Set<string>()
          for (const c of group.cells) {
            const { tr, tc } = store.tileOf(c.r, c.c)
            if (!seen.has(TileStore.key(tr, tc))) { seen.add(TileStore.key(tr, tc)); store.invalidate(tr, tc); store.load(tr, tc).catch(() => undefined) }
          }
          setSel(null)
        }
      } else {
        setMessage({ kind: 'error', text: 'Sin conexión con Lumon. Pulsa de nuevo: se reutiliza la misma clave y no se duplica.' })
      }
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }, [store, sel, id, refreshFile])

  // Mantiene la celda con foco dentro del viewport.
  const moveFocus = (r: number, c: number) => {
    const el = viewport.current
    const nr = clamp(r, 0, rows - 1)
    const nc = clamp(c, 0, cols - 1)
    setFocus({ r: nr, c: nc })
    if (!el) return
    const top = nr * CELL
    const left = nc * CELL
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + CELL > el.scrollTop + el.clientHeight) el.scrollTop = top + CELL - el.clientHeight
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = left + CELL - el.clientWidth
    setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor(view.h / CELL) - 1)
    const { r, c } = focus
    const handled = (() => {
      switch (e.key) {
        case 'ArrowUp': moveFocus(r - 1, c); return true
        case 'ArrowDown': moveFocus(r + 1, c); return true
        case 'ArrowLeft': moveFocus(r, c - 1); return true
        case 'ArrowRight': moveFocus(r, c + 1); return true
        case 'PageUp': moveFocus(r - page, c); return true
        case 'PageDown': moveFocus(r + page, c); return true
        case 'Home': moveFocus(e.ctrlKey ? 0 : r, 0); return true
        case 'End': moveFocus(e.ctrlKey ? rows - 1 : r, cols - 1); return true
        case 'Enter': case ' ': void selectAt(r, c); return true
        case 'Escape': selToken.current++; setSel(null); return true
        case '1': case '2': case '3': case '4': void sendToBin(BINS[Number(e.key) - 1]); return true
        default: return false
      }
    })()
    if (handled) e.preventDefault()
  }

  const onGridClick = (e: React.MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')
    if (!t) return
    const r = Number(t.dataset.r)
    const c = Number(t.dataset.c)
    setFocus({ r, c })
    viewport.current?.focus({ preventScroll: true })
    void selectAt(r, c)
  }

  // Arrastrar el grupo a una caja con Pointer Events (sin librerías).
  const onDragStart = (e: React.PointerEvent) => {
    if (sel?.status !== 'ready' || sel.group.noise) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ x: e.clientX, y: e.clientY })
  }
  const onDragMove = (e: React.PointerEvent) => { if (drag) setDrag({ x: e.clientX, y: e.clientY }) }
  const onDragEnd = (e: React.PointerEvent) => {
    if (!drag) return
    setDrag(null)
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-bin]')
    if (target) void sendToBin(target.dataset.bin as BinCode)
  }

  if (loadError) return <main className="p-8"><p role="alert">{loadError}</p><Link className="underline" to="/files">Volver a archivos</Link></main>
  if (!file || !rules || !store) return <main className="p-8"><p>Cargando archivo…</p></main>

  const progress = readProgress(file)
  const rowList: number[] = []
  for (let r = startRow; r <= endRow; r++) rowList.push(r)
  if (focus.r < startRow || focus.r > endRow) rowList.push(focus.r)
  const colList: number[] = []
  for (let c = startCol; c <= endCol; c++) colList.push(c)
  if (focus.c < startCol || focus.c > endCol) colList.push(focus.c)
  const suggested = sel?.status === 'ready' ? sel.group.bin : null

  return (
    <main className="flex h-screen flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link className="text-sm underline" to="/files">← Archivos</Link>
          <h1 className="text-xl font-bold">{file.name ?? `Archivo ${file.id}`} <span className="text-sm font-normal text-gray-600">{rows}×{cols} · umbral {rules.tremorThreshold} · conectividad {rules.connectivity}</span></h1>
        </div>
        <div className="w-56">
          <div className="h-3 rounded bg-gray-200" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso del archivo">
            <div className="h-3 rounded bg-emerald-600" style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="text-xs">{progress.percent}% refinado{file.totalGroups !== undefined ? ` · ${file.refinedGroups ?? 0}/${file.totalGroups} grupos` : ''}{file.mistakes ? ` · ${file.mistakes} errores` : ''}</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <div
          ref={viewport}
          role="grid"
          tabIndex={0}
          aria-label="Grilla de macrodatos. Flechas para moverse, Enter para elegir el grupo, 1 a 4 para enviarlo a una caja."
          aria-rowcount={rows}
          aria-colcount={cols}
          aria-activedescendant={`cell-${focus.r}-${focus.c}`}
          className="relative min-w-0 flex-1 overflow-auto rounded border bg-white focus:outline-2 focus:outline-sky-600"
          onScroll={(e) => { const el = e.currentTarget; setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft })) }}
          onKeyDown={onKeyDown}
          onClick={onGridClick}
        >
          <div role="presentation" style={{ width: cols * CELL, height: rows * CELL, position: 'relative' }}>
            {rowList.map((r) => (
              <div key={r} role="row" aria-rowindex={r + 1} style={{ position: 'absolute', top: r * CELL, left: 0, height: CELL, width: cols * CELL }}>
                {colList.map((c) => {
                  const { tr, tc } = store.tileOf(r, c)
                  const t = store.get(tr, tc)
                  const isFocus = focus.r === r && focus.c === c
                  const isSel = selectedKeys.has(`${r},${c}`)
                  const base = 'absolute flex items-center justify-center border border-gray-100 text-xs select-none '
                  const ring = (isFocus ? 'outline-2 -outline-offset-2 outline-sky-600 ' : '') + (isSel ? 'ring-2 ring-inset ring-fuchsia-600 ' : '')
                  const pos = { left: c * CELL, width: CELL, height: CELL }
                  if (!t) {
                    // Placeholder del mismo tamaño: el layout no salta.
                    return <div key={c} id={`cell-${r}-${c}`} role="gridcell" aria-colindex={c + 1} aria-busy="true" data-r={r} data-c={c} className={`${base}${ring}bg-gray-100`} style={pos} />
                  }
                  const i = (r - t.originRow) * t.cols + (c - t.originCol)
                  const bin = t.bins[i]
                  const tremor = t.tremor[i]
                  const scary = bin === '.' && tremor >= rules.tremorThreshold
                  const cls = bin !== '.' ? BIN_STYLE[bin] ?? '' : scary ? 'cell-scary' : ''
                  return (
                    <div
                      key={c}
                      id={`cell-${r}-${c}`}
                      role="gridcell"
                      aria-colindex={c + 1}
                      aria-selected={isSel}
                      aria-label={scary ? `${t.values[i]}, da miedo, temblor ${tremor}` : bin !== '.' ? `${t.values[i]}, refinada` : undefined}
                      data-r={r}
                      data-c={c}
                      className={`${base}${ring}${cls}`}
                      style={scary ? { ...pos, animationDuration: `${(1.1 - (tremor / 100) * 0.8).toFixed(2)}s` } : pos}
                    >
                      {t.values[i]}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <aside className="flex w-72 shrink-0 flex-col gap-3">
          <section className="rounded border p-3" aria-live="polite">
            <h2 className="font-semibold">Grupo seleccionado</h2>
            {!sel && <p className="text-sm text-gray-600">Elige una celda que dé miedo (clic o Enter).</p>}
            {sel?.status === 'loading' && <p className="text-sm">Calculando grupo…</p>}
            {sel?.status === 'error' && <p role="alert" className="text-sm text-red-700">No se pudo calcular el grupo. Inténtalo de nuevo.</p>}
            {sel?.status === 'ready' && (
              <div className="text-sm">
                <p>Tamaño: <b>{sel.group.size > rules.maxGroupSize ? `más de ${rules.maxGroupSize}` : sel.group.size}</b> celdas</p>
                {sel.group.noise
                  ? <p className="font-semibold text-amber-700">Es ruido: fuera de {rules.minGroupSize}–{rules.maxGroupSize}. No se puede refinar.</p>
                  : <p>Caja que corresponde: <b>{sel.group.bin}</b></p>}
                {!sel.group.noise && (
                  <div
                    role="button"
                    tabIndex={-1}
                    aria-label="Arrastra este grupo a una caja"
                    className="mt-2 cursor-grab touch-none rounded border-2 border-dashed border-fuchsia-600 p-2 text-center"
                    onPointerDown={onDragStart}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={() => setDrag(null)}
                  >
                    Arrástrame a una caja
                  </div>
                )}
              </div>
            )}
          </section>

          <section aria-label="Cajas" className="grid grid-cols-2 gap-2">
            {BINS.map((b, i) => {
              const done = progress.perBin[b]
              return (
                <button
                  key={b}
                  data-bin={b}
                  disabled={busy}
                  aria-keyshortcuts={String(i + 1)}
                  onClick={() => void sendToBin(b)}
                  className={`rounded border-2 p-3 text-left disabled:opacity-50 ${suggested === b ? 'border-fuchsia-600 ring-2 ring-fuchsia-300' : 'border-gray-300'} ${drag ? 'hover:bg-fuchsia-50' : ''}`}
                >
                  <span className="block font-bold">{b} <span className="text-xs font-normal text-gray-500">({i + 1})</span></span>
                  <span className="text-xs">{done !== undefined ? `${done}% refinado` : 'Enviar aquí'}</span>
                </button>
              )
            })}
          </section>

          {message && (
            <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded p-2 text-sm ${message.kind === 'error' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {message.text}
            </p>
          )}
        </aside>
      </div>

      {drag && <div aria-hidden className="pointer-events-none fixed z-50 rounded bg-fuchsia-600 px-2 py-1 text-xs text-white" style={{ left: drag.x + 8, top: drag.y + 8 }}>Grupo</div>}

      {progress.percent >= 100 && (
        <div role="dialog" aria-modal="true" aria-label="Archivo completado" className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="rounded bg-white p-8 text-center">
            <h2 className="mb-2 text-2xl font-bold">Archivo completado</h2>
            <p className="mb-4">Todos los grupos fueron refinados.</p>
            <Link className="rounded bg-emerald-600 px-4 py-2 text-white" to="/files">Volver a archivos</Link>
          </div>
        </div>
      )}
    </main>
  )
}
