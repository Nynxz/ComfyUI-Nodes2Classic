import { cropArea } from '../lib/cropArea.js'
import {
  RATIO_HEADER,
  ratioControls,
  reshapeToRatio
} from '../lib/ratioControls.js'
import {
  MARGIN,
  drawPlaceholder,
  installCanvasWidget,
  isReady,
  mediaHeight,
  setWidgetValue,
  undoable,
  upstreamImage
} from '../lib/canvas.js'

const DEFAULT = { x: 0, y: 0, width: 512, height: 512 }
const MIN_CROP = 16

/**
 * Image, then the Ratio row, as in Nodes 2.0. The frontend already adds the
 * x/y/width/height number widgets after this one.
 */
export function imageCrop(widget) {
  const area = cropArea({ min: MIN_CROP })
  const ratio = ratioControls()
  let image

  const current = () => ({ ...DEFAULT, ...widget.value })
  const imageSize = () => image && [image.naturalWidth, image.naturalHeight]

  installCanvasWidget(widget, {
    minHeight: (_node, width) => mediaHeight(width, imageSize()) + RATIO_HEADER + 8,
    draw(ctx, node, width, y, height) {
      const source = upstreamImage(node, node.inputs[0]?.name ?? 'image')
      image = isReady(source) ? source : undefined
      const room = [MARGIN, y + 2, width - MARGIN * 2, height - RATIO_HEADER - 8]
      let bottom
      if (image) {
        const frame = area.drawMedia(ctx, room, image, ...imageSize(), current())
        bottom = frame[1] + frame[3]
      } else {
        area.clearMedia()
        const box = [...room.slice(0, 3), Math.min(room[3], mediaHeight(room[2]))]
        drawPlaceholder(ctx, box, 'Run the upstream node to preview')
        bottom = box[1] + box[3]
      }
      ratio.draw(ctx, width, bottom + 4)
    },
    pointerDown(pointer, node) {
      if (this.computedDisabled) return false
      const commit = (rect) => setWidgetValue(node, widget, rect)
      return (
        ratio.pointerDown(pointer, node, current, (value) =>
          undoable(() =>
            commit(reshapeToRatio(current(), value, image?.naturalHeight, MIN_CROP))
          )
        ) ||
        area.pointerDown(pointer, node, current(), commit, { ratio: ratio.ratio })
      )
    }
  })
}
