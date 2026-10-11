import { app } from '../../../scripts/app.js'
import {
  MARGIN,
  beginGesture,
  contains,
  contextMenu,
  drawText,
  installCanvasWidget,
  localPos,
  setWidgetValue,
  undoable
} from '../lib/canvas.js'

const MAX_COLORS = 16
const SWATCH = 14
const GAP = 4

let openPicker

/** Opens the browser's colour picker; the whole edit is one undo step. */
export function pickColour(event, hex, onInput) {
  openPicker?.()
  const input = document.createElement('input')
  input.type = 'color'
  input.value = /^#[0-9a-f]{6}/i.exec(hex)?.[0] ?? '#ffffff'
  Object.assign(input.style, {
    position: 'fixed',
    left: `${event.clientX}px`,
    top: `${event.clientY}px`,
    width: '1px',
    height: '1px',
    opacity: '0',
    border: '0',
    padding: '0'
  })
  document.body.append(input)
  app.canvas.emitBeforeChange()
  const close = () => {
    if (openPicker !== close) return
    openPicker = undefined
    input.remove()
    app.canvas.emitAfterChange()
  }
  openPicker = close
  input.addEventListener('input', () => onInput(input.value))
  input.addEventListener('change', close)
  input.addEventListener('cancel', close)
  if (input.showPicker) input.showPicker()
  else input.click()
}

export function colors(widget) {
  let hits = []

  const current = () => (Array.isArray(widget.value) ? widget.value : [])

  installCanvasWidget(widget, {
    draw(ctx, _node, width, y, height) {
      const middle = y + height / 2
      drawText(ctx, this.label || this.name, MARGIN + 6, middle)
      const values = current()
      let x = Math.max(width * 0.4, MARGIN + 80)
      const top = middle - SWATCH / 2
      hits = []
      ctx.save()
      for (const [index, hex] of values.entries()) {
        if (x + SWATCH > width - MARGIN) break
        ctx.fillStyle = hex
        ctx.fillRect(x, top, SWATCH, SWATCH)
        ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR
        ctx.strokeRect(x + 0.5, top + 0.5, SWATCH - 1, SWATCH - 1)
        hits.push({ index, box: [x, top, SWATCH, SWATCH] })
        x += SWATCH + GAP
      }
      if (values.length < MAX_COLORS && x + SWATCH <= width - MARGIN) {
        ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR
        ctx.strokeRect(x + 0.5, top + 0.5, SWATCH - 1, SWATCH - 1)
        drawText(ctx, '+', x + SWATCH / 2, middle + 1, { align: 'center' })
        hits.push({ index: -1, box: [x, top, SWATCH, SWATCH] })
      }
      ctx.restore()
    },
    pointerDown(pointer, node) {
      const [px, py] = localPos(pointer.eDown, node)
      const hit = hits.find(({ box }) => contains(box, px, py))
      if (!hit) return false
      const replaceAt = (index, hex) => {
        const next = current().slice()
        next[index] = hex
        setWidgetValue(node, widget, next)
      }
      if (hit.index !== -1) {
        let from = hit.index
        pointer.onDragStart = () => beginGesture(pointer)
        pointer.onDrag = (event) => {
          const [x] = localPos(event, node)
          const swatches = hits.filter(({ index }) => index !== -1)
          const target = swatches.findLast(({ box }) => x >= box[0])?.index ?? 0
          if (target === from) return
          const next = current().slice()
          next.splice(target, 0, ...next.splice(from, 1))
          from = target
          setWidgetValue(node, widget, next)
        }
      }
      pointer.onClick = (event) => {
        if (hit.index === -1) {
          const index = current().length
          undoable(() =>
            setWidgetValue(node, widget, [...current(), '#ffffff'])
          )
          pickColour(event, '#ffffff', (hex) => replaceAt(index, hex))
          return
        }
        contextMenu(event, [
          [
            'Change colour…',
            () =>
              pickColour(event, current()[hit.index], (hex) =>
                replaceAt(hit.index, hex)
              )
          ],
          [
            'Remove',
            () =>
              undoable(() =>
                setWidgetValue(
                  node,
                  widget,
                  current().filter((_, i) => i !== hit.index)
                )
              )
          ]
        ])
      }
      return true
    }
  })
}
