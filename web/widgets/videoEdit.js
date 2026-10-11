import { cropArea } from '../lib/cropArea.js'
import { filmstrip, formatFileSize } from '../lib/filmstrip.js'
import {
  RATIO_HEADER,
  ratioControls,
  reshapeToRatio
} from '../lib/ratioControls.js'
import {
  INFO_ROW,
  ROW,
  ROW_GAP,
  drawDivider,
  drawInfoRow,
  drawNumberRow,
  numberRowPointerDown
} from '../lib/rows.js'
import { videoMedia } from '../lib/videoMedia.js'
import {
  MARGIN,
  annotatedFileUrl,
  beginGesture,
  clamp,
  contains,
  drawPlaceholder,
  drawText,
  fitTop,
  installCanvasWidget,
  localPos,
  mediaHeight,
  nodeOutput,
  setWidgetValue,
  sourceNode,
  undoable,
  viewUrl
} from '../lib/canvas.js'

const PLAYBACK = 26
const STRIP = 64
const STRIP_BAR = 8
const STRIP_HANDLE = 12
const SELECTION = '#ffd500'
const PLAYHEAD = '#f0513b'
const MIN_CROP = 2
const INFO_ROWS = 5

const roundSeconds = (value) => Math.round(value * 1000) / 1000
const clock = (value) => {
  const total = Math.max(0, Math.round(value))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
const shortSeconds = (value) => `${Math.round(value * 10) / 10}s`

function sourceUrl(node) {
  const source = sourceNode(node, 'video')
  if (!source) return undefined
  const file = source.widgets?.find((w) => w.name === 'file')?.value
  const output = nodeOutput(source)
  const saved = output?.images?.[0] ?? output?.gifs?.[0] ?? output?.video?.[0]
  return (saved && viewUrl(saved)) ?? annotatedFileUrl(file)
}

/** Frame maths ported from the frontend's useVideoEditModel. */
function frameModel(value, duration, fps) {
  const totalFrames = Math.max(Math.round(duration * fps), 1)
  const frameMax = Math.max(totalFrames - 1, 0)
  const toTime = (frame) => (frame / totalFrames) * duration
  const toFrame = (time) => Math.round((time / duration) * totalFrames)
  const trim = value.trim ?? { start_time: 0, duration: 0 }
  const startTime = Math.max(trim.start_time ?? 0, 0)
  const toEnd = !(trim.duration > 0)
  const endTime = toEnd ? duration : startTime + trim.duration
  const startFrame = clamp(toFrame(startTime), 0, frameMax)
  const endFrame = toEnd ? frameMax : clamp(toFrame(endTime) - 1, 0, frameMax)
  return {
    totalFrames,
    frameMax,
    startFrame,
    endFrame,
    startTime,
    endTime,
    toTime,
    trimForStart(frame) {
      const start = roundSeconds(toTime(clamp(frame, 0, Math.max(endFrame - 1, 0))))
      return {
        start_time: start,
        duration: toEnd ? 0 : roundSeconds(Math.max(endTime - start, 0))
      }
    },
    trimForEnd(frame) {
      const minEnd = clamp(toFrame(startTime) + 1, 0, frameMax)
      const end = clamp(frame, minEnd, frameMax)
      return {
        start_time: startTime,
        duration:
          end >= frameMax ? 0 : roundSeconds(Math.max(toTime(end + 1) - startTime, 0))
      }
    }
  }
}

function layoutHeight(width, meta, hasTrim, hasCrop) {
  return (
    mediaHeight(width, meta && [meta.width, meta.height]) +
    PLAYBACK +
    (hasTrim ? STRIP + ROW_GAP + 2 * (ROW + ROW_GAP) : 0) +
    (hasCrop ? RATIO_HEADER + 4 * (ROW + ROW_GAP) : 0) +
    9 +
    INFO_ROWS * INFO_ROW +
    10
  )
}

/** The Nodes 2.0 trim strip: thumbnails, a yellow selection frame, a playhead. */
function drawFilmstrip(ctx, rect, thumbs, aspect, model, playheadTime, duration) {
  const [x, y, w, h] = rect
  const tileTop = y + STRIP_BAR
  const tileHeight = h - STRIP_BAR * 2
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(...rect, 8)
  ctx.clip()
  ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR
  ctx.fillRect(...rect)
  const tileWidth = tileHeight * aspect
  const tiles = Math.max(1, Math.ceil(w / tileWidth))
  for (let i = 0; i < tiles && thumbs.length; i++) {
    const index = Math.min(thumbs.length - 1, Math.floor(((i + 0.5) / tiles) * thumbs.length))
    ctx.drawImage(thumbs[index], x + i * tileWidth, tileTop, tileWidth, tileHeight)
  }
  const toX = (frame) => x + (frame / (model.frameMax + 1)) * w
  const left = toX(model.startFrame)
  const right = toX(model.endFrame + 1)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(x, y, left - x, h)
  ctx.fillRect(right, y, x + w - right, h)
  ctx.fillStyle = SELECTION
  ctx.fillRect(left, y, right - left, STRIP_BAR)
  ctx.fillRect(left, y + h - STRIP_BAR, right - left, STRIP_BAR)
  for (const [hx, corners] of [
    [left, [8, 0, 0, 8]],
    [right - STRIP_HANDLE, [0, 8, 8, 0]]
  ]) {
    ctx.fillStyle = SELECTION
    ctx.beginPath()
    ctx.roundRect(hx, y, STRIP_HANDLE, h, corners)
    ctx.fill()
    ctx.fillStyle = '#26232b'
    ctx.fillRect(hx + STRIP_HANDLE / 2 - 0.5, y + h / 2 - 8, 1, 16)
  }
  if (duration > 0) {
    ctx.fillStyle = PLAYHEAD
    ctx.fillRect(x + (playheadTime / duration) * w - 1, tileTop, 2, tileHeight)
  }
  ctx.restore()
  const toFrame = (px) =>
    clamp(Math.floor(((px - x) / w) * (model.frameMax + 1)), 0, model.frameMax)
  return { left, right, toFrame }
}

export function videoEdit(widget) {
  const area = cropArea({ min: MIN_CROP })
  const ratio = ratioControls()
  const media = videoMedia()
  const strip = filmstrip()
  let hits = {}

  const features = () => widget.options.features ?? ['trim', 'crop']
  const value = () => widget.value ?? {}

  function cropRect(meta) {
    const crop = value().crop
    if (crop?.width > 0 && crop?.height > 0) return crop
    return meta
      ? { x: 0, y: 0, width: meta.width, height: meta.height }
      : { x: 0, y: 0, width: 0, height: 0 }
  }

  function setTrim(node, trim) {
    setWidgetValue(node, widget, { ...value(), trim })
  }

  function setCrop(node, next, meta) {
    const full =
      meta &&
      next.x <= 0 &&
      next.y <= 0 &&
      next.width >= meta.width &&
      next.height >= meta.height
    setWidgetValue(node, widget, {
      ...value(),
      crop: full ? { x: 0, y: 0, width: 0, height: 0 } : next
    })
  }

  /** Plays inside the trim range, looping, repainting every frame. */
  function togglePlay(node, model) {
    const video = media.element
    if (!video || !media.meta) return
    if (!video.paused) {
      video.pause()
      return
    }
    const [start, end] = model ? [model.startTime, model.endTime] : [0, video.duration]
    if (video.currentTime < start || video.currentTime >= end - 0.05)
      video.currentTime = start
    void video.play()
    const tick = () => {
      if (media.element !== video || video.paused) return
      if (video.currentTime >= end) video.currentTime = start
      node.setDirtyCanvas(true, false)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  installCanvasWidget(widget, {
    minHeight: (_node, width) => {
      const [hasTrim, hasCrop] = ['trim', 'crop'].map((f) => features().includes(f))
      return layoutHeight(width, media.meta, hasTrim, hasCrop)
    },

    draw(ctx, node, width, y) {
      const [hasTrim, hasCrop] = ['trim', 'crop'].map((f) => features().includes(f))
      const url = sourceUrl(node)
      media.source(url)
      strip.source(url)
      const meta = media.meta
      const fps = strip.fps
      const duration = strip.duration ?? meta?.duration
      const model = meta && fps ? frameModel(value(), duration, fps) : undefined
      const inner = width - MARGIN * 2
      hits = {}

      const room = [
        MARGIN,
        y + 2,
        inner,
        mediaHeight(inner, meta && [meta.width, meta.height])
      ]
      const frame = media.frame
      if (meta && frame) {
        if (hasCrop)
          area.drawMedia(ctx, room, frame, meta.width, meta.height, cropRect(meta))
        else {
          area.clearMedia()
          ctx.drawImage(frame, ...fitTop(meta.width, meta.height, room))
        }
      } else {
        area.clearMedia()
        drawPlaceholder(ctx, room, url ? 'Loading video…' : 'Connect a video')
      }
      let top = room[1] + room[3] + 2

      const video = media.element
      const middle = top + PLAYBACK / 2
      const playing = !!video && !video.paused
      drawText(ctx, playing ? '❚❚' : '▶', MARGIN + 10, middle, {
        align: 'center',
        color: LiteGraph.WIDGET_TEXT_COLOR
      })
      hits.play = [MARGIN, top, 24, PLAYBACK]
      const time = meta
        ? `${clock(media.time)} / ${clock(duration)}`
        : '0:00 / 0:00'
      drawText(ctx, time, MARGIN + 28, middle, { size: 11 })
      const timeWidth = ctx.measureText(time).width
      drawText(ctx, video?.muted === false ? '🔊' : '🔇', width - MARGIN - 10, middle, {
        align: 'center'
      })
      hits.mute = [width - MARGIN - 22, top, 22, PLAYBACK]
      const scrub = [
        MARGIN + 40 + timeWidth,
        middle - 2,
        Math.max(0, inner - 74 - timeWidth),
        4
      ]
      ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR
      ctx.beginPath()
      ctx.roundRect(...scrub, 2)
      ctx.fill()
      if (meta) {
        const knob = scrub[0] + (media.time / duration) * scrub[2]
        ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR
        ctx.beginPath()
        ctx.roundRect(scrub[0], scrub[1], Math.max(0, knob - scrub[0]), 4, 2)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(knob, middle, 6, 0, Math.PI * 2)
        ctx.fill()
        hits.scrub = { bar: scrub, duration: duration }
      }
      top += PLAYBACK

      if (hasTrim) {
        const rect = [MARGIN, top, inner, STRIP]
        if (model)
          hits.strip = {
            rect,
            ...drawFilmstrip(
              ctx,
              rect,
              strip.thumbs,
              meta.width / meta.height,
              model,
              media.time,
              duration
            )
          }
        else drawPlaceholder(ctx, rect, 'Reading frames…')
        top += STRIP + ROW_GAP
        hits.startRow = drawNumberRow(
          ctx,
          [MARGIN, top, inner, ROW],
          'Start Frame',
          model?.startFrame ?? '—'
        )
        top += ROW + ROW_GAP
        hits.endRow = drawNumberRow(
          ctx,
          [MARGIN, top, inner, ROW],
          'End Frame',
          model?.endFrame ?? '—'
        )
        top += ROW + ROW_GAP
      }

      if (hasCrop) {
        ratio.draw(ctx, width, top)
        top += RATIO_HEADER
        const rect = cropRect(meta)
        hits.cropRows = ['x', 'y', 'width', 'height'].map((key) => {
          const row = drawNumberRow(
            ctx,
            [MARGIN, top, inner, ROW],
            key,
            Math.round(rect[key])
          )
          top += ROW + ROW_GAP
          return { key, row }
        })
      }

      drawDivider(ctx, MARGIN, top + 4, inner)
      top += 9
      const durationText = meta
        ? hasTrim && model
          ? `${shortSeconds(model.endTime - model.startTime)} / ${shortSeconds(duration)}`
          : shortSeconds(duration)
        : '—'
      const frames = model
        ? hasTrim
          ? `${model.endFrame - model.startFrame + 1} / ${model.totalFrames}`
          : String(model.totalFrames)
        : '—'
      for (const [label, text] of [
        ['Dimensions', meta ? `${meta.width} × ${meta.height}` : '—'],
        ['Duration', durationText],
        ['Frame Rate', fps ? `${Math.round(fps * 100) / 100} fps` : '—'],
        ['Number of Frames', frames],
        ['File Size', formatFileSize(strip.size)]
      ]) {
        drawInfoRow(ctx, [MARGIN, top, inner, INFO_ROW], label, text)
        top += INFO_ROW
      }
    },

    pointerDown(pointer, node) {
      if (this.computedDisabled) return false
      const local = localPos(pointer.eDown, node)
      const meta = media.meta
      const fps = strip.fps
      const duration = strip.duration ?? meta?.duration
      const model = meta && fps ? frameModel(value(), duration, fps) : undefined
      const video = media.element

      if (hits.play && contains(hits.play, ...local)) {
        pointer.onClick = () =>
          togglePlay(node, features().includes('trim') ? model : undefined)
        return true
      }
      if (hits.mute && contains(hits.mute, ...local)) {
        pointer.onClick = () => {
          if (video) video.muted = !video.muted
          node.setDirtyCanvas(true, false)
        }
        return true
      }
      if (hits.scrub) {
        const { bar, duration } = hits.scrub
        if (contains([bar[0] - 8, bar[1] - 10, bar[2] + 16, bar[3] + 20], ...local)) {
          const scrubTo = (x) => {
            video.pause()
            media.seek(clamp(((x - bar[0]) / bar[2]) * duration, 0, duration))
          }
          scrubTo(local[0])
          pointer.onDrag = (event) => scrubTo(localPos(event, node)[0])
          pointer.onClick = () => {}
          return true
        }
      }

      if (model) {
        const frameRow = (rect, title, frame, trimFor) =>
          rect &&
          numberRowPointerDown(pointer, node, rect, title, frame, (next) =>
            setTrim(node, trimFor(Math.round(next)))
          )
        if (frameRow(hits.startRow, 'Start Frame', model.startFrame, model.trimForStart))
          return true
        if (frameRow(hits.endRow, 'End Frame', model.endFrame, model.trimForEnd))
          return true
      }

      if (model && hits.strip && contains(hits.strip.rect, ...local)) {
        const { left, right, toFrame } = hits.strip
        const near = (edge) => Math.abs(local[0] - edge) <= STRIP_HANDLE + 4
        const handle = near(left) ? 'start' : near(right) ? 'end' : undefined
        video?.pause()
        if (!handle) {
          const seekTo = (x) => media.seek(model.toTime(toFrame(x)))
          seekTo(local[0])
          pointer.onDrag = (event) => seekTo(localPos(event, node)[0])
          pointer.onClick = () => {}
          return true
        }
        beginGesture(pointer)
        pointer.onDrag = (event) => {
          const frame = toFrame(localPos(event, node)[0])
          const current = frameModel(value(), duration, fps)
          setTrim(
            node,
            handle === 'start' ? current.trimForStart(frame) : current.trimForEnd(frame)
          )
          media.seek(current.toTime(frame))
        }
        pointer.onClick = () => {}
        return true
      }

      if (!features().includes('crop')) return false
      const rect = cropRect(meta)
      for (const { key, row } of hits.cropRows ?? []) {
        if (
          numberRowPointerDown(pointer, node, row, key, Math.round(rect[key]), (next) =>
            setCrop(node, { ...rect, [key]: Math.max(0, Math.round(next)) }, meta)
          )
        )
          return true
      }
      return (
        ratio.pointerDown(pointer, node, () => rect, (locked) =>
          undoable(() =>
            setCrop(node, reshapeToRatio(rect, locked, meta?.height, MIN_CROP), meta)
          )
        ) ||
        area.pointerDown(pointer, node, rect, (next) => setCrop(node, next, meta), {
          ratio: ratio.ratio,
          maxWidth: meta?.width,
          maxHeight: meta?.height
        })
      )
    }
  })
}
