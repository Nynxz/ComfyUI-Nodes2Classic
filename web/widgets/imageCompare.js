import {
  MARGIN,
  contains,
  drawPlaceholder,
  drawText,
  fitTop,
  imageCache,
  installCanvasWidget,
  isReady,
  localPos,
  mediaHeight,
  nodeOutput,
  sourceNode,
  viewUrl
} from '../lib/canvas.js'

const BATCH_HEIGHT = 20
const SIDES = [
  { input: 'image_a', output: 'a_images', label: 'A' },
  { input: 'image_b', output: 'b_images', label: 'B' }
]

/** Upstream previews win over this node's saved run, as in Nodes 2.0. */
function sideSources(node, side) {
  const upstream = sourceNode(node, side.input)?.imgs
  if (upstream?.length) return upstream.map((image) => ({ image }))
  return (nodeOutput(node)?.[side.output] ?? []).map((file) => ({ url: viewUrl(file) }))
}

export function imageCompare(widget) {
  const caches = SIDES.map(() => imageCache())
  const index = [0, 0]
  let split = 0.5
  let shown
  let batch = false
  let frame
  let navHits = []

  function images(node) {
    return SIDES.map((side, i) => {
      const sources = sideSources(node, side)
      index[i] = Math.min(index[i], Math.max(0, sources.length - 1))
      const source = sources[index[i]]
      const image = source?.image ?? caches[i](source?.url)
      return { image: isReady(image) ? image : undefined, count: sources.length }
    })
  }

  function drawBatchNav(ctx, sides, width, y) {
    navHits = []
    const middle = y + BATCH_HEIGHT / 2
    sides.forEach(({ count }, i) => {
      if (count < 2) return
      const left = i === 0
      const text = `${SIDES[i].label}  ‹  ${index[i] + 1}/${count}  ›`
      const x = left ? MARGIN + 4 : width - MARGIN - 4
      drawText(ctx, text, x, middle, { align: left ? 'left' : 'right', size: 11 })
      const textWidth = ctx.measureText(text).width
      const start = left ? x : x - textWidth
      const half = textWidth / 2
      navHits.push({ side: i, step: -1, count, box: [start, y, half, BATCH_HEIGHT] })
      navHits.push({ side: i, step: 1, count, box: [start + half, y, half, BATCH_HEIGHT] })
    })
  }

  installCanvasWidget(widget, {
    minHeight: (_node, width) =>
      mediaHeight(width, shown) + (batch ? BATCH_HEIGHT : 0) + 8,
    draw(ctx, node, width, y, height) {
      const sides = images(node)
      const hasBatch = sides.some(({ count }) => count > 1)
      batch = hasBatch
      if (hasBatch) drawBatchNav(ctx, sides, width, y)
      else navHits = []
      const top = y + (hasBatch ? BATCH_HEIGHT : 0)
      const box = [MARGIN, top + 2, width - MARGIN * 2, y + height - top - 6]
      const [a, b] = sides.map((side) => side.image)
      frame = undefined
      if (!a && !b) {
        box[3] = Math.min(box[3], mediaHeight(box[2]))
        drawPlaceholder(ctx, box, 'Connect image_a / image_b and run')
        return
      }
      const first = a ?? b
      shown = [first.naturalWidth, first.naturalHeight]
      frame = fitTop(...shown, box)
      const [fx, fy, fw, fh] = frame
      const splitX = fx + fw * split
      if (b) ctx.drawImage(b, ...frame)
      if (a) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(fx, fy, splitX - fx, fh)
        ctx.clip()
        ctx.drawImage(a, ...frame)
        ctx.restore()
      }
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(splitX, fy)
      ctx.lineTo(splitX, fy + fh)
      ctx.stroke()
    },
    pointerDown(pointer, node) {
      const local = localPos(pointer.eDown, node)
      const nav = navHits.find(({ box }) => contains(box, ...local))
      if (nav) {
        pointer.onClick = () => {
          index[nav.side] = (index[nav.side] + nav.step + nav.count) % nav.count
          node.setDirtyCanvas(true, false)
        }
        return true
      }
      if (!frame) return false
      const [fx, , fw] = frame
      const setSplit = (event) => {
        split = Math.min(1, Math.max(0, (localPos(event, node)[0] - fx) / fw))
        node.setDirtyCanvas(true, false)
      }
      setSplit(pointer.eDown)
      pointer.onDrag = setSplit
      pointer.onClick = () => {}
      return true
    }
  })
}
