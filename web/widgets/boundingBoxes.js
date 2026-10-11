import { app } from '../../../scripts/app.js'
import {
  MARGIN,
  beginGesture,
  contains,
  contextMenu,
  dragRect,
  drawHandles,
  drawText,
  fitTop,
  font,
  hitRect,
  imageCache,
  installCanvasWidget,
  isReady,
  localPos,
  mediaHeight,
  nodeOutput,
  rectFromPoints,
  roundRect,
  savedImage,
  setWidgetValue,
  undoable,
  upstreamImage
} from '../lib/canvas.js'

const MIN_BOX = 8
const MAX_PALETTE = 5
const DIMENSION_STEP = 16
const NEUTRAL = '#8c8c8c'
const GRID_PX = 32
const MAX_GRID_CELLS = 64

/** Dot grid in canvas pixels, like the Nodes 2.0 editor (node.properties.bboxGrid). */
function drawGrid(ctx, frame, size) {
  const step = Math.max(GRID_PX, Math.ceil(Math.max(...size) / MAX_GRID_CELLS))
  const scale = frame[2] / size[0]
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  for (let gx = step; gx < size[0]; gx += step)
    for (let gy = step; gy < size[1]; gy += step) {
      ctx.beginPath()
      ctx.arc(frame[0] + gx * scale, frame[1] + gy * scale, 1, 0, Math.PI * 2)
      ctx.fill()
    }
}

const newMetadata = () => ({ type: 'obj', text: '', desc: '', palette: [] })

function normalizeHex(colour) {
  const hex = String(colour).trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(hex) ? hex : null
}

function normalizeBox(box) {
  const meta = box.metadata && typeof box.metadata === 'object' ? box.metadata : {}
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    metadata: {
      type: meta.type === 'text' ? 'text' : 'obj',
      text: typeof meta.text === 'string' ? meta.text : '',
      desc: typeof meta.desc === 'string' ? meta.desc : '',
      palette: Array.isArray(meta.palette)
        ? meta.palette.map(normalizeHex).filter(Boolean)
        : []
    }
  }
}

const isBox = (b) =>
  !!b && ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number')

function boxLabel(box, index) {
  const { type, text, desc } = box.metadata
  const body = (type === 'text' ? `“${text}”` : text || desc).trim()
  return `${index + 1}${type === 'text' ? ' T' : ''}${body ? ` · ${body}` : ''}`
}

export function boundingBoxes(widget) {
  const cache = imageCache()
  let frame
  let size
  let active = -1
  let sizedFor

  const widgetNamed = (node, name) => node.widgets?.find((w) => w.name === name)
  const dimension = (node, name) => {
    const v = widgetNamed(node, name)?.value
    return typeof v === 'number' && v > 0 ? v : 1024
  }
  const boxes = () => (Array.isArray(widget.value) ? widget.value.filter(isBox) : [])

  const toScreen = ({ x, y, width, height }) => {
    const s = frame[2] / size[0]
    return [frame[0] + x * s, frame[1] + y * s, width * s, height * s]
  }
  const toCanvas = ([sx, sy]) => {
    const s = size[0] / frame[2]
    return [(sx - frame[0]) * s, (sy - frame[1]) * s]
  }

  function background(node) {
    const slot = node.findInputSlot('background')
    if (slot === -1 || !node.isInputConnected(slot)) return undefined
    const image =
      upstreamImage(node, 'background') ??
      savedImage(cache, nodeOutput(node)?.background_images)
    return isReady(image) ? image : undefined
  }

  /** A background sets the canvas size, like the Nodes 2.0 editor. */
  function sizeToBackground(node, image) {
    if (sizedFor === image.src) return
    sizedFor = image.src
    const snap = (v) =>
      Math.max(DIMENSION_STEP, Math.round(v / DIMENSION_STEP) * DIMENSION_STEP)
    for (const [name, natural] of [
      ['width', image.naturalWidth],
      ['height', image.naturalHeight]
    ]) {
      const target = widgetNamed(node, name)
      if (target && target.value !== snap(natural))
        setWidgetValue(node, target, snap(natural))
    }
  }

  /** New upstream `bboxes` replace the editor state once per distinct value. */
  function applyIncoming(node) {
    const slot = node.findInputSlot('bboxes')
    if (slot === -1 || !node.isInputConnected(slot)) return
    const incoming = nodeOutput(node)?.input_bboxes
    if (!Array.isArray(incoming) || !incoming.length || !incoming.every(isBox)) return
    const lastIncoming = widgetNamed(node, 'last_incoming')
    if (JSON.stringify(lastIncoming?.value ?? []) === JSON.stringify(incoming)) return
    if (lastIncoming) setWidgetValue(node, lastIncoming, structuredClone(incoming))
    setWidgetValue(node, widget, incoming.map(normalizeBox))
    active = 0
  }

  function commit(node, next) {
    setWidgetValue(node, widget, next)
  }

  function editMetadata(node, index, patch) {
    undoable(() =>
      commit(
        node,
        boxes().map((box, i) =>
          i === index
            ? normalizeBox({ ...box, metadata: { ...normalizeBox(box).metadata, ...patch } })
            : box
        )
      )
    )
  }

  function promptText(event, title, value, apply) {
    app.canvas.prompt(title, value, apply, event, true)
  }

  function boxMenu(event, node, index) {
    const box = normalizeBox(boxes()[index])
    const { type, text, desc, palette } = box.metadata
    const move = (to) =>
      undoable(() => {
        const next = boxes().filter((_, i) => i !== index)
        next.splice(to === 'front' ? next.length : 0, 0, boxes()[index])
        active = to === 'front' ? next.length - 1 : 0
        commit(node, next)
      })
    contextMenu(event, [
      [
        type === 'text' ? 'Type: text → object' : 'Type: object → text',
        () => editMetadata(node, index, { type: type === 'text' ? 'obj' : 'text' })
      ],
      [
        type === 'text' ? 'Edit text…' : 'Edit label…',
        () => promptText(event, 'Text', text, (v) => editMetadata(node, index, { text: v }))
      ],
      [
        'Edit description…',
        () => promptText(event, 'Description', desc, (v) => editMetadata(node, index, { desc: v }))
      ],
      [
        'Edit palette…',
        () =>
          app.canvas.prompt(
            'Palette (hex, comma separated)',
            palette.join(', '),
            (v) =>
              editMetadata(node, index, {
                palette: v
                  .split(/[\s,]+/)
                  .map(normalizeHex)
                  .filter(Boolean)
                  .slice(0, MAX_PALETTE)
              }),
            event
          )
      ],
      ['Bring to front', () => move('front')],
      ['Send to back', () => move('back')],
      [
        'Delete',
        () =>
          undoable(() => {
            active = -1
            commit(node, boxes().filter((_, i) => i !== index))
          })
      ]
    ])
  }

  installCanvasWidget(widget, {
    minHeight: (node, width) =>
      mediaHeight(width, [dimension(node, 'width'), dimension(node, 'height')]) + 8,
    draw(ctx, node, width, y, height) {
      applyIncoming(node)
      size = [dimension(node, 'width'), dimension(node, 'height')]
      frame = fitTop(size[0], size[1], [MARGIN, y + 2, width - MARGIN * 2, height - 6])
      const image = background(node)
      if (image) sizeToBackground(node, image)

      ctx.save()
      ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR
      ctx.fillRect(...frame)
      if (image) {
        ctx.drawImage(image, ...frame)
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(...frame)
      }
      if (node.properties?.bboxGrid !== false) drawGrid(ctx, frame, size)
      ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR
      ctx.strokeRect(...frame)
      ctx.beginPath()
      ctx.rect(...frame)
      ctx.clip()

      const list = boxes().map(normalizeBox)
      if (!list.length)
        drawText(ctx, 'Drag to draw a box · click a box to edit', frame[0] + frame[2] / 2, frame[1] + frame[3] / 2, { align: 'center' })
      list.forEach((box, index) => {
        const rect = toScreen(box)
        const colour = box.metadata.palette[0] ?? NEUTRAL
        const isActive = index === active
        ctx.fillStyle = colour.slice(0, 7) + (isActive ? '3a' : '22')
        ctx.fillRect(...rect)
        ctx.strokeStyle = colour.slice(0, 7)
        ctx.lineWidth = isActive ? 2 : 1.5
        ctx.strokeRect(...rect)
        box.metadata.palette.forEach((swatch, i) => {
          ctx.fillStyle = swatch
          ctx.fillRect(rect[0] + rect[2] - 10 - i * 10, rect[1] + 3, 8, 8)
        })
        ctx.font = font(11, 'bold')
        const label = boxLabel(box, index)
        const tagWidth = Math.min(ctx.measureText(label).width + 8, Math.max(rect[2], 24))
        ctx.fillStyle = colour.slice(0, 7)
        ctx.fillRect(rect[0], rect[1] - 15, tagWidth, 15)
        ctx.save()
        ctx.beginPath()
        ctx.rect(rect[0], rect[1] - 15, tagWidth, 15)
        ctx.clip()
        drawText(ctx, label, rect[0] + 4, rect[1] - 7, { size: 11, weight: 'bold', color: '#fff' })
        ctx.restore()
        if (isActive) drawHandles(ctx, rect)
      })
      ctx.restore()
    },

    pointerDown(pointer, node) {
      if (!frame) return false
      const local = localPos(pointer.eDown, node)
      if (!contains(frame, ...local)) return false

      const list = boxes()
      const hitAt = (index) => (index >= 0 && list[index] ? hitRect(toScreen(list[index]), ...local) : undefined)
      let index = hitAt(active) ? active : -1
      if (index === -1)
        for (let i = list.length - 1; i >= 0; i--)
          if (hitAt(i) === 'move') {
            index = i
            break
          }
      const mode = index === -1 ? undefined : hitAt(index)
      const origin = toCanvas(local)
      const [W, H] = size

      let dragged = false
      pointer.onDragStart = () => {
        dragged = true
        beginGesture(pointer)
      }
      pointer.onDrag = (event) => {
        const point = toCanvas(localPos(event, node))
        if (index === -1) {
          const rect = rectFromPoints(...origin, ...point, W, H)
          if (rect.width < MIN_BOX || rect.height < MIN_BOX) return
          index = list.length
          active = index
          commit(node, [...list, { ...roundRect(rect), metadata: newMetadata() }])
          return
        }
        const start = list[index] ?? boxes()[index]
        const rect =
          index >= list.length
            ? rectFromPoints(...origin, ...point, W, H)
            : dragRect(start, mode, point[0] - origin[0], point[1] - origin[1], W, H, MIN_BOX)
        active = index
        commit(
          node,
          boxes().map((box, i) => (i === index ? { ...box, ...roundRect(rect) } : box))
        )
      }
      pointer.onClick = (event) => {
        if (dragged) return
        if (index === -1) {
          active = -1
          node.setDirtyCanvas(true, false)
          const gridOn = node.properties?.bboxGrid !== false
          contextMenu(event, [
            [
              gridOn ? 'Hide grid' : 'Show grid',
              () => {
                node.properties = { ...node.properties, bboxGrid: !gridOn }
                node.setDirtyCanvas(true, false)
              }
            ],
            ...(list.length
              ? [['Clear all boxes', () => undoable(() => commit(node, []))]]
              : [])
          ])
          return
        }
        active = index
        node.setDirtyCanvas(true, false)
        boxMenu(event, node, index)
      }
      return true
    }
  })
}
