import { app } from '../../scripts/app.js'
import { boundingBoxes } from './widgets/boundingBoxes.js'
import { colors } from './widgets/colors.js'
import { curve } from './widgets/curve.js'
import { dynamicGroup, withShortRowLabels } from './widgets/dynamicGroup.js'
import { imageCompare } from './widgets/imageCompare.js'
import { imageCrop } from './widgets/imageCrop.js'
import { resolutionPreview } from './widgets/resolutionPreview.js'
import { videoEdit } from './widgets/videoEdit.js'
import { fitNodeToContent } from './lib/canvas.js'

/** Input types whose widgets are drawn only by Nodes 2.0 in the frontend. */
const NODES2_INPUT_TYPES = new Set([
  'BOUNDING_BOX',
  'BOUNDING_BOXES',
  'COLORS',
  'COMFY_DYNAMICGROUP_V3',
  'CURVE',
  'IMAGECOMPARE',
  'RESOLUTION_PREVIEW',
  'VIDEO_EDIT'
])

const BY_WIDGET_TYPE = {
  boundingboxes: boundingBoxes,
  colors,
  curve,
  imagecompare: imageCompare,
  imagecrop: imageCrop,
  resolutionpreview: resolutionPreview,
  videoedit: videoEdit
}

/** Finds the input types anywhere in a node def, including group/autogrow templates. */
function inputTypes(spec, found = new Set()) {
  if (Array.isArray(spec)) {
    if (typeof spec[0] === 'string') found.add(spec[0])
    for (const item of spec) inputTypes(item, found)
  } else if (spec && typeof spec === 'object') {
    for (const value of Object.values(spec)) inputTypes(value, found)
  }
  return found
}

/**
 * Like ZenKit's `widget_input(socketless=True)`: these widgets are the node's
 * own editor, so no input socket. The frontend reads `options.socketless`
 * straight after creating a widget, before it adds the widget's slot.
 */
const SOCKETLESS_WIDGET_TYPES = new Set(Object.keys(BY_WIDGET_TYPE))
const isGroupRowField = (widget) => /\.\d+\.[^.$]+$/.test(widget.name)

app.registerExtension({
  name: 'Nynxz.Nodes2Classic',

  beforeRegisterNodeDef(nodeType, nodeData) {
    const types = inputTypes(nodeData.input)
    if (![...types].some((type) => NODES2_INPUT_TYPES.has(type))) return
    const hasDynamicGroup = types.has('COMFY_DYNAMICGROUP_V3')

    const addCustomWidget = nodeType.prototype.addCustomWidget
    nodeType.prototype.addCustomWidget = function (custom) {
      const widget = addCustomWidget.call(this, custom)
      if (
        SOCKETLESS_WIDGET_TYPES.has(widget.type) ||
        (hasDynamicGroup && isGroupRowField(widget))
      )
        widget.options.socketless = true
      if (hasDynamicGroup) dynamicGroup(widget, this)
      BY_WIDGET_TYPE[widget.type]?.(widget)
      return widget
    }

    if (hasDynamicGroup) {
      const drawWidgets = nodeType.prototype.drawWidgets
      nodeType.prototype.drawWidgets = function (...args) {
        return withShortRowLabels(() => drawWidgets.apply(this, args))
      }
    }

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (...args) {
      const result = onConfigure?.apply(this, args)
      fitNodeToContent(this)
      return result
    }
  }
})
