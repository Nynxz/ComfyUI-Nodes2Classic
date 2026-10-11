import {
  MARGIN,
  beginGesture,
  clamp,
  contains,
  drawText,
  installCanvasWidget,
  localPos,
  nodeOutput,
  setWidgetValue,
  undoable
} from '../lib/canvas.js'

const POINT_HIT = 8
const HEADER = 20
const DEFAULT = {
  points: [
    [0, 0],
    [1, 1]
  ],
  interpolation: 'monotone_cubic'
}

const sortPoints = (points) => [...points].sort((a, b) => a[0] - b[0])

function linear(points) {
  return (x) => {
    if (x <= points[0][0]) return points[0][1]
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1]
      const [x1, y1] = points[i]
      if (x <= x1) return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
    return points.at(-1)[1]
  }
}

/** Monotone cubic Hermite, matching src/components/curve/curveUtils.ts. */
function monotone(points) {
  const n = points.length
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const deltas = []
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i]
    deltas.push(dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx)
  }
  const slopes = [deltas[0] ?? 0]
  for (let i = 1; i < n - 1; i++)
    slopes.push(deltas[i - 1] * deltas[i] <= 0 ? 0 : (deltas[i - 1] + deltas[i]) / 2)
  slopes.push(deltas[n - 2] ?? 0)
  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      slopes[i] = slopes[i + 1] = 0
      continue
    }
    const a = slopes[i] / deltas[i]
    const b = slopes[i + 1] / deltas[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      slopes[i] = t * a * deltas[i]
      slopes[i + 1] = t * b * deltas[i]
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let lo = 0
    let hi = n - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid
    }
    const dx = xs[hi] - xs[lo]
    if (dx === 0) return ys[lo]
    const t = (x - xs[lo]) / dx
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * dx * slopes[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] +
      (t3 - t2) * dx * slopes[hi]
    )
  }
}

function interpolator(points, interpolation) {
  if (points.length < 2) return () => points[0]?.[1] ?? 0
  return interpolation === 'linear' ? linear(points) : monotone(points)
}

export function curve(widget) {
  let plot
  let toggle

  const current = () =>
    widget.value?.points?.length ? widget.value : structuredClone(DEFAULT)

  const toScreen = ([x, y]) => [plot[0] + x * plot[2], plot[1] + (1 - y) * plot[3]]
  const toCurve = ([sx, sy]) => [
    clamp((sx - plot[0]) / plot[2], 0, 1),
    clamp(1 - (sy - plot[1]) / plot[3], 0, 1)
  ]

  installCanvasWidget(widget, {
    minHeight: (_node, width) => clamp(width, 120, 420) + HEADER + 8,
    draw(ctx, node, width, y, height) {
      const { points, interpolation } = current()
      const size = Math.min(width - MARGIN * 2, height - HEADER - 6)
      plot = [(width - size) / 2, y + HEADER, size, size]
      const [px, py, pw, ph] = plot
      const label = interpolation === 'linear' ? 'linear' : 'smooth'
      drawText(ctx, this.label || this.name, px, y + HEADER / 2)
      drawText(ctx, `${label} ▾`, px + pw, y + HEADER / 2, { align: 'right' })
      toggle = [px + pw - 70, y, 70, HEADER]

      ctx.save()
      ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR
      ctx.fillRect(...plot)
      ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR
      ctx.strokeRect(...plot)

      const histogram = nodeOutput(node)?.histogram
      if (Array.isArray(histogram) && histogram.length) {
        const peak = Math.max(...histogram) || 1
        ctx.fillStyle = 'rgba(255,255,255,0.08)'
        const barWidth = pw / histogram.length
        histogram.forEach((count, i) => {
          const barHeight = (count / peak) * ph
          ctx.fillRect(px + i * barWidth, py + ph - barHeight, barWidth, barHeight)
        })
      }

      ctx.globalAlpha = 0.25
      ctx.beginPath()
      for (const f of [0.25, 0.5, 0.75]) {
        ctx.moveTo(px + pw * f, py)
        ctx.lineTo(px + pw * f, py + ph)
        ctx.moveTo(px, py + ph * f)
        ctx.lineTo(px + pw, py + ph * f)
      }
      ctx.moveTo(px, py + ph)
      ctx.lineTo(px + pw, py)
      ctx.stroke()
      ctx.globalAlpha = 1

      const sorted = sortPoints(points)
      const evaluate = interpolator(sorted, interpolation)
      ctx.strokeStyle = LiteGraph.WIDGET_TEXT_COLOR
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i <= 128; i++) {
        const x = i / 128
        const [sx, sy] = toScreen([x, clamp(evaluate(x), 0, 1)])
        if (i === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      }
      ctx.stroke()

      ctx.fillStyle = '#fff'
      for (const point of sorted) {
        const [sx, sy] = toScreen(point)
        ctx.beginPath()
        ctx.arc(sx, sy, 4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    },
    pointerDown(pointer, node) {
      if (!plot || this.computedDisabled) return false
      const local = localPos(pointer.eDown, node)
      const value = current()

      if (contains(toggle, ...local)) {
        pointer.onClick = () =>
          undoable(() =>
            setWidgetValue(node, widget, {
              ...value,
              interpolation:
                value.interpolation === 'linear' ? 'monotone_cubic' : 'linear'
            })
          )
        return true
      }
      if (!contains(plot, ...local)) return false

      const nearest = value.points.findIndex((point) => {
        const [sx, sy] = toScreen(point)
        return Math.hypot(sx - local[0], sy - local[1]) <= POINT_HIT
      })
      beginGesture(pointer)
      let points = value.points.map((p) => [...p])
      let dragged = points[nearest]
      if (!dragged) {
        dragged = toCurve(local)
        points = sortPoints([...points, dragged])
        setWidgetValue(node, widget, { ...value, points })
      }
      pointer.onDrag = (event) => {
        const moved = toCurve(localPos(event, node))
        points = sortPoints(points.map((p) => (p === dragged ? moved : p)))
        dragged = moved
        setWidgetValue(node, widget, { ...value, points })
      }
      pointer.onDoubleClick = () => {
        if (points.length <= 2) return
        points = points.filter((p) => p !== dragged)
        setWidgetValue(node, widget, { ...value, points })
      }
      pointer.onClick = () => {}
      return true
    }
  })
}
