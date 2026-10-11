import {
  MARGIN,
  defineCanvasOnly,
  drawText,
  findDescriptor,
  localPos
} from '../lib/canvas.js'

const REMOVE_HIT_WIDTH = 28

function canvasTier(widget, surfaces) {
  if (widget.type === 'dynamic_group_notice') return 'never'
  return surfaces.canvas === 'never' && surfaces.vueNode !== 'never'
    ? 'shown'
    : surfaces.canvas
}

/**
 * The frontend creates DynamicGroup rows with `surfaces.canvas = 'never'`,
 * sometimes re-assigning `options` after the widget exists, so the canvas tier
 * is rewritten on every options write rather than once.
 */
function showOnCanvas(widget) {
  const base = findDescriptor(widget, 'options')
  if (!base?.set) return
  const withCanvas = (options) =>
    options?.surfaces
      ? {
          ...options,
          surfaces: {
            ...options.surfaces,
            canvas: canvasTier(widget, options.surfaces)
          }
        }
      : options
  Object.defineProperty(widget, 'options', {
    configurable: true,
    enumerable: base.enumerable,
    get() {
      return base.get.call(this)
    },
    set(options) {
      base.set.call(this, withCanvas(options))
    }
  })
  widget.options = widget.options
}

function drawRowHeader(ctx, _node, width, y, height) {
  const middle = y + height / 2
  const label = this.label ?? this.name
  const closeX = width - MARGIN - REMOVE_HIT_WIDTH / 2
  const labelRight = width - MARGIN - REMOVE_HIT_WIDTH
  ctx.save()
  drawText(ctx, label, labelRight, middle, { align: 'right' })
  const labelLeft = labelRight - ctx.measureText(label).width - 8
  ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR
  ctx.beginPath()
  ctx.moveTo(MARGIN, middle)
  ctx.lineTo(labelLeft, middle)
  ctx.stroke()
  if (this.options.disabled) ctx.globalAlpha *= 0.35
  drawText(ctx, '✕', closeX, middle, {
    align: 'center',
    color: LiteGraph.WIDGET_TEXT_COLOR
  })
  ctx.restore()
}

function onRowHeaderPointerDown(pointer, node) {
  const width = this.width || node.size[0]
  if (this.options.disabled) return false
  if (localPos(pointer.eDown, node)[0] < width - MARGIN - REMOVE_HIT_WIDTH)
    return false
  pointer.onClick = () => this.callback?.()
  return true
}

let drawingCanvas = false

/** Runs a node's canvas widget pass with short row-field labels. */
export function withShortRowLabels(draw) {
  drawingCanvas = true
  try {
    return draw()
  } finally {
    drawingCanvas = false
  }
}

/**
 * Like Nodes 2.0's WidgetGrid, a field labelled "LoRA #1 strength" under a
 * "LoRA #1" header shows as "strength". The stored label is untouched, so the
 * frontend's row renaming still matches it.
 */
function shortenRowFieldLabel(widget, node) {
  const match = /^(.+\.\d+)\.[^.]+$/.exec(widget.name)
  const base = findDescriptor(widget, 'label')
  if (!match || !base?.get) return
  Object.defineProperty(widget, 'label', {
    configurable: true,
    enumerable: base.enumerable,
    get() {
      const label = base.get.call(this)
      if (!drawingCanvas || typeof label !== 'string') return label
      const rowName = /^(.+\.\d+)\.[^.]+$/.exec(this.name)?.[1]
      const header = node.widgets?.find((w) => w.name === rowName)?.label
      return header && label.startsWith(`${header} `)
        ? label.slice(header.length + 1)
        : label
    },
    set(value) {
      base.set.call(this, value)
    }
  })
}

export function dynamicGroup(widget, node) {
  showOnCanvas(widget)
  shortenRowFieldLabel(widget, node)
  if (widget.type === 'dynamic_group_row')
    defineCanvasOnly(widget, {
      draw: drawRowHeader,
      onPointerDown: onRowHeaderPointerDown
    })
}
