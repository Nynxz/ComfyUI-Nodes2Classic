import { api } from '../../../scripts/api.js'
import { redraw } from './canvas.js'

const THUMB_COUNT = 16
const THUMB_HEIGHT = 72
const DEFAULT_FPS = 20
const STANDARD_FPS = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60, 120]

const once = (target, event, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeout)
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })

function snapFps(fps) {
  const nearest = STANDARD_FPS.reduce((best, rate) =>
    Math.abs(rate - fps) < Math.abs(best - fps) ? rate : best
  )
  return Math.abs(nearest - fps) <= 0.03 * nearest ? nearest : fps
}

/**
 * Nodes 2.0 reads fps from the container; a canvas pack can't, so measure it
 * from presented-frame timestamps during a short muted play.
 */
async function measureFps(video) {
  if (!video.requestVideoFrameCallback) return DEFAULT_FPS
  const times = []
  await new Promise((resolve) => {
    const stop = setTimeout(resolve, 1500)
    const onFrame = (_now, { mediaTime }) => {
      times.push(mediaTime)
      if (times.length >= 10) {
        clearTimeout(stop)
        resolve()
      } else video.requestVideoFrameCallback(onFrame)
    }
    video.requestVideoFrameCallback(onFrame)
    video.play().catch(resolve)
  })
  video.pause()
  const steps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((step) => step > 0.001)
  if (!steps.length) return DEFAULT_FPS
  return snapFps(1 / Math.min(...steps))
}

/**
 * The container's fps/duration/size, read server-side with ComfyUI's own
 * VideoFromFile — the numbers the trim/crop nodes execute with.
 */
async function containerMeta(url) {
  const { pathname, search } = new URL(url, location.href)
  if (!pathname.endsWith('/view')) return undefined
  try {
    const response = await fetch(api.apiURL(`/nodes2classic/video_meta${search}`))
    return response.ok ? await response.json() : undefined
  } catch {
    return undefined
  }
}

/** Thumbnails, fps and file size for one video URL, loaded in the background. */
export function filmstrip() {
  let url
  let state = {}

  async function build(source) {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = source
    const next = { thumbs: [] }
    state = next
    try {
      const meta = await containerMeta(source)
      if (meta) Object.assign(next, { fps: meta.fps, duration: meta.duration, size: meta.size })
      await once(video, 'loadeddata', 15000)
      next.fps ??= await measureFps(video)
      redraw()
      const width = Math.round((THUMB_HEIGHT * video.videoWidth) / video.videoHeight)
      for (let i = 0; i < THUMB_COUNT; i++) {
        if (url !== source) return
        video.currentTime = ((i + 0.5) / THUMB_COUNT) * video.duration
        await once(video, 'seeked')
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = THUMB_HEIGHT
        canvas.getContext('2d').drawImage(video, 0, 0, width, THUMB_HEIGHT)
        next.thumbs.push(canvas)
        redraw()
      }
    } catch {
      next.fps ??= DEFAULT_FPS
    } finally {
      video.removeAttribute('src')
    }
  }

  return {
    source(next) {
      if (next !== url) {
        url = next
        state = {}
        if (next) void build(next)
      }
      return this
    },
    get thumbs() {
      return state.thumbs ?? []
    },
    get fps() {
      return state.fps
    },
    get size() {
      return state.size
    },
    get duration() {
      return state.duration
    }
  }
}

export function formatFileSize(bytes) {
  if (!(bytes > 0)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** power
  return `${power ? Math.round(value) : value} ${units[power]}`
}
