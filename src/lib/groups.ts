// Grupos = componentes conexos de celdas con tremor >= umbral. Flood fill ITERATIVO
// (una pila propia): una recursión se desbordaría con grupos grandes.
import type { Rules } from './files'
import type { Tile } from './tiles'

export interface Cell { r: number; c: number }

export interface Group {
  cells: Cell[]
  size: number
  noise: boolean // fuera de [minGroupSize, maxGroupSize]
  bin: string | null // caja que corresponde (null si es ruido)
}

const N4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const N8: [number, number][] = [...N4, [-1, -1], [-1, 1], [1, -1], [1, 1]]

export function binFor(digits: number[], rules: Rules): string {
  const { strategy, order } = rules.binning
  const idx = (strategy === 'MAX_DIGIT_MOD' ? Math.max(...digits) : digits.reduce((a, b) => a + b, 0)) % order.length
  return order[idx]
}

export async function findGroup(
  start: Cell,
  rules: Rules,
  rows: number,
  cols: number,
  tileSize: number,
  loadTile: (tr: number, tc: number) => Promise<Tile>,
): Promise<Group> {
  const dirs = rules.connectivity === 8 ? N8 : N4
  const tileOf = (r: number, c: number) => loadTile(Math.floor(r / tileSize), Math.floor(c / tileSize))
  const index = (t: Tile, r: number, c: number) => (r - t.originRow) * t.cols + (c - t.originCol)
  const scary = (t: Tile, r: number, c: number) => {
    const i = index(t, r, c)
    return t.tremor[i] >= rules.tremorThreshold && t.bins[i] === '.'
  }

  const first = await tileOf(start.r, start.c)
  if (!scary(first, start.r, start.c)) return { cells: [], size: 0, noise: true, bin: null }

  const visited = new Set<number>([start.r * cols + start.c])
  const stack: Cell[] = [start]
  const cells: Cell[] = []
  const digits: number[] = []

  while (stack.length > 0) {
    const cur = stack.pop() as Cell
    const t = await tileOf(cur.r, cur.c)
    cells.push(cur)
    digits.push(Number(t.values[index(t, cur.r, cur.c)]))
    // Un grupo más grande que el máximo ya es ruido: no hace falta seguir pidiendo bloques.
    if (cells.length > rules.maxGroupSize) break
    for (const [dr, dc] of dirs) {
      const r = cur.r + dr
      const c = cur.c + dc
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue
      const k = r * cols + c
      if (visited.has(k)) continue
      visited.add(k)
      const nt = await tileOf(r, c)
      if (scary(nt, r, c)) stack.push({ r, c })
    }
  }

  const noise = cells.length < rules.minGroupSize || cells.length > rules.maxGroupSize
  return { cells, size: cells.length, noise, bin: noise ? null : binFor(digits, rules) }
}
