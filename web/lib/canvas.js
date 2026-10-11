import { app } from '../../../scripts/app.js'
import { api } from '../../../scripts/api.js'

export const MARGIN = 15

export function findDescriptor(object, key) {
  for (let o = object; o; o = Object.getPrototypeOf(o)) {
    const descriptor = Object.getOwnPropertyDescriptor(o, key)
    if (descriptor) return descriptor
  }
}

/**
 * Nodes 2.0 renders any widget that has a `draw` function through its generic
 * legacy-canvas component, so the classic-only members are hidden whenever
 * Vue nodes are active and the widget keeps its native Vue component.
 */
export function defineCanvasOnly(widget, members) {
  for (const [key, value] of Object.entries(members)) {
    const original = widget[key]
    Object.defineProperty(widget, key, {
      configurable: true,
      get: () => (LiteGraph.vueNodesMode ? original : value)
    })
  }
}

/**
 * Draws a widget clipped to its own row and the node body, passing the height
 * actually available so content scales down instead of spilling out.
 */
export function installCanvasWidget(widget, { draw, pointerDown, minHeight }) {
  function containedDraw(ctx, node, width, y) {
    if (typeof minHeight === 'function') growToContent(this, node)
    const height = Math.min(widgetHeight(this), node.size[1] - y)
    if (height <= 0) return
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, y, width, height)
    ctx.clip()
    try {
      draw.call(this, ctx, node, width, y, height)
    } finally {
      ctx.restore()
    }
  }
  defineCanvasOnly(widget, {
    draw: containedDraw,
    onPointerDown: pointerDown,
    ...(minHeight && {
      computeLayoutSize: (node) => ({
        minHeight:
          typeof minHeight === 'function'
            ? Math.ceil(minHeight(node, node.size[0] - MARGIN * 2))
            : minHeight,
        minWidth: 0
      })
    })
  })
}

export function localPos(event, node) {
  return [event.canvasX - node.pos[0], event.canvasY - node.pos[1]]
}

export function widgetHeight(widget) {
  return widget.computedHeight ?? LiteGraph.NODE_WIDGET_HEIGHT
}

/** Media can load with a different aspect than first guessed: grow, never shrink. */
function growToContent(widget, node) {
  const { minHeight } = widget.computeLayoutSize(node)
  if ((widget.computedHeight ?? minHeight) < minHeight - 1) fitNodeToContent(node)
}

/** Grows a node whose saved size predates its canvas widgets. */
export function fitNodeToContent(node) {
  if (LiteGraph.vueNodesMode) return
  const [minWidth, minHeight] = node.computeSize()
  if (node.size[0] >= minWidth && node.size[1] >= minHeight) return
  node.setSize([Math.max(node.size[0], minWidth), Math.max(node.size[1], minHeight)])
  node.setDirtyCanvas(true, true)
}

export function setWidgetValue(node, widget, value) {
  const previous = widget.value
  widget.value = value
  widget.callback?.(value, app.canvas, node)
  node.onWidgetChanged?.(widget.name, value, previous, widget)
  node.graph?.incrementVersion?.()
  node.setDirtyCanvas(true, false)
}

export function undoable(change) {
  app.canvas.emitBeforeChange()
  try {
    change()
  } finally {
    app.canvas.emitAfterChange()
  }
}

/** Starts an undoable gesture: one undo step however many values it writes. */
export function beginGesture(pointer) {
  app.canvas.emitBeforeChange()
  const end = pointer.finally
  pointer.finally = () => {
    end?.()
    app.canvas.emitAfterChange()
  }
}

export function redraw() {
  app.graph?.setDirtyCanvas(true, false)
}

// Text, panels ---------------------------------------------------------------

export function font(size = LiteGraph.NODE_SUBTEXT_SIZE, weight = '') {
  return `${weight} ${size}px ${LiteGraph.NODE_FONT}`.trim()
}

export function drawText(ctx, text, x, y, options = {}) {
  ctx.font = font(options.size, options.weight)
  ctx.fillStyle = options.color ?? LiteGraph.WIDGET_SECONDARY_TEXT_COLOR
  ctx.textAlign = options.align ?? 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

export function drawPlaceholder(ctx, box, message) {
  ctx.save()
  ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR
  ctx.setLineDash([4, 4])
  ctx.strokeRect(...box)
  ctx.setLineDash([])
  drawText(ctx, message, box[0] + box[2] / 2, box[1] + box[3] / 2, {
    align: 'center'
  })
  ctx.restore()
}

export function contextMenu(event, items) {
  new LiteGraph.ContextMenu(
    items.map(([content, callback]) => ({ content, callback })),
    { event, scale: Math.max(1, app.canvas.ds.scale) }
  )
}

export function promptNumber(event, title, value, apply) {
  app.canvas.prompt(
    title,
    value,
    (text) => {
      const number = Number(text)
      if (Number.isFinite(number)) apply(number)
    },
    event
  )
}

// Images ---------------------------------------------------------------------

export function annotatedFileUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw === 'Loading...') return
  const match = /^(.*?) \[(\w+)\]$/.exec(raw)
  const path = match ? match[1] : raw
  const annotation = match?.[2]?.toLowerCase()
  const type =
    annotation === 'output' || annotation === 'temp' ? annotation : 'input'
  const slash = path.lastIndexOf('/')
  const params = new URLSearchParams({
    filename: path.slice(slash + 1),
    subfolder: slash === -1 ? '' : path.slice(0, slash),
    type
  })
  return api.apiURL(`/view?${params}`)
}

export function loadImage(url) {
  const image = new Image()
  image.onload = redraw
  image.src = url
  return image
}

export function isReady(image) {
  return !!image?.complete && image.naturalWidth > 0
}

export function nodeOutput(node) {
  const graph = node.graph
  const locator =
    graph && graph !== app.rootGraph ? `${graph.id}:${node.id}` : String(node.id)
  return app.nodeOutputs?.[locator]
}

export function sourceNode(node, inputName) {
  const slot = node.findInputSlot(inputName)
  if (slot === -1 || !node.isInputConnected(slot)) return null
  let source = node.getInputNode(slot)
  let link = node.getInputLink(slot)
  const visited = new Set()
  while (source?.isSubgraphNode?.() && link && !visited.has(source)) {
    visited.add(source)
    const resolved = source.resolveSubgraphOutputLink(link.origin_slot)
    source = resolved?.outputNode ?? null
    link = resolved?.link
  }
  return source
}

export function upstreamImage(node, inputName) {
  const source = sourceNode(node, inputName)
  return source?.imgs?.[source.imageIndex ?? 0]
}

/** Image cache keyed by URL so redraws never reload. */
export function imageCache() {
  let url
  let image
  return (next) => {
    if (!next) return undefined
    if (next !== url) {
      url = next
      image = loadImage(next)
    }
    return image
  }
}

export function savedImage(cache, output) {
  const first = output?.[0]
  return first ? cache(viewUrl(first)) : undefined
}

export function viewUrl({ filename, subfolder = '', type = 'output' }) {
  const params = new URLSearchParams({ filename, subfolder, type })
  return api.apiURL(`/view?${params}${app.getPreviewFormatParam()}`)
}

// Geometry -------------------------------------------------------------------

export function fitRect(width, height, [x, y, w, h]) {
  if (!(width > 0 && height > 0)) return [x, y, w, h]
  const scale = Math.min(w / width, h / height)
  const fw = width * scale
  const fh = height * scale
  return [x + (w - fw) / 2, y + (h - fh) / 2, fw, fh]
}

/** Like {@link fitRect} but pinned to the top, so controls can follow it. */
export function fitTop(width, height, box) {
  const [x, , w, h] = fitRect(width, height, box)
  return [x, box[1], w, h]
}

/** Height of media of the given size shown at `width`, capped to a sane range. */
export function mediaHeight(width, size, fallback = 9 / 16) {
  const aspect = size?.[0] > 0 && size?.[1] > 0 ? size[1] / size[0] : fallback
  return clamp(width * aspect, 80, 900)
}

export function contains([x, y, w, h], px, py) {
  return px >= x && px <= x + w && py >= y && py <= y + h
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

const EDGE = 7

/** 'move' | 'n' 's' 'e' 'w' 'ne' 'nw' 'se' 'sw' | undefined, in screen px. */
export function hitRect([x, y, w, h], px, py) {
  const inX = px >= x - EDGE && px <= x + w + EDGE
  const inY = py >= y - EDGE && py <= y + h + EDGE
  if (!inX || !inY) return undefined
  const v = Math.abs(py - y) <= EDGE ? 'n' : Math.abs(py - y - h) <= EDGE ? 's' : ''
  const hz = Math.abs(px - x) <= EDGE ? 'w' : Math.abs(px - x - w) <= EDGE ? 'e' : ''
  if (v || hz) return v + hz
  return contains([x, y, w, h], px, py) ? 'move' : undefined
}

/**
 * Applies a drag to a rect in content units, clamped to `[0, maxW] × [0, maxH]`.
 * `ratio` keeps width/height fixed when resizing.
 */
export function dragRect(start, mode, dx, dy, maxW, maxH, min = 1, ratio) {
  let { x, y, width, height } = start
  if (mode === 'move') {
    return {
      x: clamp(x + dx, 0, maxW - width),
      y: clamp(y + dy, 0, maxH - height),
      width,
      height
    }
  }
  let x2 = x + width
  let y2 = y + height
  if (mode.includes('w')) x = clamp(x + dx, 0, x2 - min)
  if (mode.includes('e')) x2 = clamp(x2 + dx, x + min, maxW)
  if (mode.includes('n')) y = clamp(y + dy, 0, y2 - min)
  if (mode.includes('s')) y2 = clamp(y2 + dy, y + min, maxH)
  width = x2 - x
  height = y2 - y
  if (!ratio) return { x, y, width, height }
  const west = mode.includes('w')
  const north = mode.includes('n')
  const anchorX = west ? x2 : x
  const anchorY = north ? y2 : y
  let w = /[ew]/.test(mode) ? width : height * ratio
  let h = w / ratio
  const fit = Math.min(
    1,
    (west ? anchorX : maxW - anchorX) / w,
    (north ? anchorY : maxH - anchorY) / h
  )
  w *= fit
  h *= fit
  return {
    x: west ? anchorX - w : anchorX,
    y: north ? anchorY - h : anchorY,
    width: w,
    height: h
  }
}

/** Draws a rect from two corner points (content units), normalised and clamped. */
export function rectFromPoints(ax, ay, bx, by, maxW, maxH) {
  const x1 = clamp(Math.min(ax, bx), 0, maxW)
  const y1 = clamp(Math.min(ay, by), 0, maxH)
  const x2 = clamp(Math.max(ax, bx), 0, maxW)
  const y2 = clamp(Math.max(ay, by), 0, maxH)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

export function roundRect({ x, y, width, height }) {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

/** Round corner handles, like the Nodes 2.0 crop overlay. */
export function drawHandles(ctx, [x, y, w, h], colour = '#fff') {
  ctx.fillStyle = colour
  for (const [hx, hy] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h]
  ]) {
    ctx.beginPath()
    ctx.arc(hx, hy, 5, 0, Math.PI * 2)
    ctx.fill()
  }
}
