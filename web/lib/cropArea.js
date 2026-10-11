import {
  beginGesture,
  contains,
  dragRect,
  drawHandles,
  drawText,
  fitTop,
  hitRect,
  localPos,
  promptNumber,
  rectFromPoints,
  roundRect,
  undoable
} from './canvas.js'

const FIELDS = [
  ['x', 'x'],
  ['y', 'y'],
  ['w', 'width'],
  ['h', 'height']
]

/**
 * A crop rectangle over an image or video frame. `width`/`height` are the
 * media's natural size; rects are in media pixels.
 */
export function cropArea({ min = 16 } = {}) {
  let frame
  let size
  let cells = []

  const toScreen = ({ x, y, width, height }) => {
    const scale = frame[2] / size[0]
    return [frame[0] + x * scale, frame[1] + y * scale, width * scale, height * scale]
  }
  const toMedia = ([sx, sy]) => {
    const scale = size[0] / frame[2]
    return [(sx - frame[0]) * scale, (sy - frame[1]) * scale]
  }

  return {
    drawMedia(ctx, box, media, width, height, rect) {
      size = [width, height]
      frame = fitTop(width, height, box)
      ctx.save()
      ctx.drawImage(media, ...frame)
      const [cx, cy, cw, ch] = toScreen(rect)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.beginPath()
      ctx.rect(...frame)
      ctx.rect(cx, cy + ch, cw, -ch)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1)
      drawHandles(ctx, [cx, cy, cw, ch])
      ctx.restore()
      return frame
    },

    clearMedia() {
      frame = undefined
    },

    drawFields(ctx, row, rect) {
      const [x, y, w, h] = row
      const cellWidth = w / FIELDS.length
      cells = FIELDS.map(([label, key], i) => {
        const box = [x + i * cellWidth, y, cellWidth, h]
        drawText(ctx, label, box[0] + 6, y + h / 2)
        drawText(ctx, String(Math.round(rect[key] ?? 0)), box[0] + cellWidth - 6, y + h / 2, {
          align: 'right',
          color: LiteGraph.WIDGET_TEXT_COLOR
        })
        return { key, label, box }
      })
    },

    /** `commit(rect)` writes a new value; returns true when the pointer was used. */
    pointerDown(pointer, node, rect, commit, { maxWidth, maxHeight, ratio } = {}) {
      const local = localPos(pointer.eDown, node)
      const cell = cells.find(({ box }) => contains(box, ...local))
      if (cell) {
        pointer.onClick = (event) =>
          promptNumber(event, cell.label, Math.round(rect[cell.key] ?? 0), (value) =>
            undoable(() =>
              commit({ ...rect, [cell.key]: Math.max(0, Math.round(value)) })
            )
          )
        return true
      }
      if (!frame || !contains(frame, ...local)) return false

      const [W, H] = [maxWidth ?? size[0], maxHeight ?? size[1]]
      const mode = hitRect(toScreen(rect), ...local)
      const origin = toMedia(local)
      const start = { ...rect }
      beginGesture(pointer)
      pointer.onDrag = (event) => {
        const point = toMedia(localPos(event, node))
        const next = mode
          ? dragRect(
              start,
              mode,
              point[0] - origin[0],
              point[1] - origin[1],
              W,
              H,
              min,
              mode === 'move'
                ? undefined
                : (ratio ?? (event.shiftKey ? start.width / start.height : undefined))
            )
          : rectFromPoints(...origin, ...point, W, H)
        if (next.width >= 1 && next.height >= 1) commit(roundRect(next))
      }
      pointer.onClick = () => {}
      return true
    }
  }
}
