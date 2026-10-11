import { drawText, installCanvasWidget } from '../lib/canvas.js'

function roundHalfToEven(value) {
  const floor = Math.floor(value)
  if (value - floor !== 0.5) return Math.round(value)
  return floor % 2 === 0 ? floor : floor + 1
}

/** Mirrors ResolutionSelector.execute in comfy_extras/nodes_resolution.py. */
export function resolveResolution(ratio, megapixels, multiple) {
  const match =
    typeof ratio === 'string'
      ? /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(ratio)
      : null
  if (!match || !(megapixels > 0) || !(multiple > 0)) return null
  const [wRatio, hRatio] = [Number(match[1]), Number(match[2])]
  if (!(wRatio > 0) || !(hRatio > 0)) return null
  const scale = Math.sqrt((megapixels * 1024 * 1024) / (wRatio * hRatio))
  const width = roundHalfToEven((wRatio * scale) / multiple) * multiple
  const height = roundHalfToEven((hRatio * scale) / multiple) * multiple
  return width && height ? { width, height } : null
}

export function resolutionPreview(widget) {
  installCanvasWidget(widget, {
    draw(ctx, node, width, y, height) {
      const value = (name) => node.widgets?.find((w) => w.name === name)?.value
      const { ratio_widget, megapixels_widget, multiple_widget } = this.options
      const resolution = resolveResolution(
        value(ratio_widget ?? 'aspect_ratio'),
        value(megapixels_widget ?? 'megapixels'),
        value(multiple_widget ?? 'multiple')
      )
      const middle = y + height / 2
      if (!resolution) {
        drawText(ctx, '—', width / 2, middle, { align: 'center' })
        return
      }
      const megapixels = (
        (resolution.width * resolution.height) /
        (1024 * 1024)
      ).toFixed(2)
      drawText(
        ctx,
        `${resolution.width} × ${resolution.height}`,
        width / 2 - 4,
        middle,
        { align: 'right', color: LiteGraph.WIDGET_TEXT_COLOR }
      )
      drawText(ctx, `${megapixels} MP`, width / 2 + 4, middle)
    }
  })
}
