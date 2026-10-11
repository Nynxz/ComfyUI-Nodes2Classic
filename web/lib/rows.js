import { contains, drawText, localPos, promptNumber, undoable } from './canvas.js'

export const ROW = 20
export const ROW_GAP = 4
export const INFO_ROW = 18

function pill(ctx, [x, y, w, h]) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, h / 2)
}

function arrow(ctx, x, y, size, direction) {
  ctx.beginPath()
  ctx.moveTo(x - size * direction, y - size)
  ctx.lineTo(x + size * direction, y)
  ctx.lineTo(x - size * direction, y + size)
  ctx.fill()
}

/** A number row in the litegraph widget style: ◀ label … value ▶. */
export function drawNumberRow(ctx, rect, label, value) {
  const [x, y, w, h] = rect
  const middle = y + h / 2
  ctx.save()
  ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR
  ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR
  pill(ctx, rect)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR
  arrow(ctx, x + 12, middle, 5, -1)
  arrow(ctx, x + w - 12, middle, 5, 1)
  drawText(ctx, label, x + 24, middle)
  drawText(ctx, String(value), x + w - 24, middle, {
    align: 'right',
    color: LiteGraph.WIDGET_TEXT_COLOR
  })
  ctx.restore()
  return rect
}

export function drawInfoRow(ctx, [x, y, w, h], label, value) {
  const middle = y + h / 2
  drawText(ctx, label, x + 4, middle)
  drawText(ctx, value, x + w - 4, middle, {
    align: 'right',
    color: LiteGraph.WIDGET_TEXT_COLOR
  })
}

export function drawDivider(ctx, x, y, w) {
  ctx.save()
  ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR
  ctx.beginPath()
  ctx.moveTo(x, y + 0.5)
  ctx.lineTo(x + w, y + 0.5)
  ctx.stroke()
  ctx.restore()
}

/**
 * Handles a press on a number row: the arrows step by one, the middle opens
 * a prompt. `set(value)` receives the requested value; one undo step each.
 */
export function numberRowPointerDown(pointer, node, rect, title, value, set) {
  const local = localPos(pointer.eDown, node)
  if (!contains(rect, ...local)) return false
  const [x, , w] = rect
  pointer.onClick = (event) => {
    if (local[0] < x + 24) undoable(() => set(value - 1))
    else if (local[0] > x + w - 24) undoable(() => set(value + 1))
    else promptNumber(event, title, value, (next) => undoable(() => set(next)))
  }
  return true
}
