import { MARGIN, contains, contextMenu, drawText, localPos } from './canvas.js'

export const RATIO_HEADER = 22

const RATIOS = {
  custom: null,
  '1:1': 1,
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16
}

/**
 * The crop editors' "Ratio ▾ · lock ratio" header, as in Nodes 2.0. The lock
 * is per editor session, like the Vue widget's.
 */
export function ratioControls() {
  let locked = null
  let ratioHit
  let lockHit

  const name = () =>
    Object.entries(RATIOS).find(([, v]) => v === locked)?.[0] ?? 'custom'

  return {
    get ratio() {
      return locked ?? undefined
    },

    draw(ctx, width, y) {
      const middle = y + RATIO_HEADER / 2
      const right = width - MARGIN
      drawText(ctx, 'Ratio', MARGIN + 4, middle)
      drawText(ctx, `${name()} ▾`, MARGIN + 44, middle, {
        color: LiteGraph.WIDGET_TEXT_COLOR
      })
      ratioHit = [MARGIN, y, 110, RATIO_HEADER]
      drawText(ctx, locked == null ? '○ lock ratio' : '● ratio locked', right - 4, middle, {
        align: 'right',
        color: locked == null ? undefined : LiteGraph.WIDGET_TEXT_COLOR
      })
      lockHit = [right - 100, y, 100, RATIO_HEADER]
    },

    /**
     * `current()` is the crop rect now; `apply(ratio)` reshapes it to a newly
     * chosen ratio. Returns true when the press hit the header.
     */
    pointerDown(pointer, node, current, apply) {
      const local = localPos(pointer.eDown, node)
      if (ratioHit && contains(ratioHit, ...local)) {
        pointer.onClick = (event) =>
          contextMenu(
            event,
            Object.entries(RATIOS).map(([label, value]) => [
              label,
              () => {
                locked = value
                if (value != null) apply(value)
                node.setDirtyCanvas(true, false)
              }
            ])
          )
        return true
      }
      if (lockHit && contains(lockHit, ...local)) {
        pointer.onClick = () => {
          const rect = current()
          locked =
            locked == null && rect.width > 0 && rect.height > 0
              ? rect.width / rect.height
              : null
          node.setDirtyCanvas(true, false)
        }
        return true
      }
      return false
    }
  }
}

/** Mirrors applyLockedRatio in the frontend's useImageCrop. */
export function reshapeToRatio(rect, ratio, maxHeight, min) {
  let height = Math.round(rect.width / ratio)
  let width = rect.width
  if (maxHeight && rect.y + height > maxHeight) {
    height = maxHeight - rect.y
    width = Math.max(min, Math.round(height * ratio))
  }
  return { ...rect, width, height: Math.max(min, height) }
}
