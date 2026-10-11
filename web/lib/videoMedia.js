import { redraw } from './canvas.js'

const POSTER_MAX_WIDTH = 1280

/**
 * A `<video>` for canvas drawing that never blinks: layout reads metadata (known
 * through seeks), the last decoded frame is kept and drawn while a seek is in
 * flight, and seeks coalesce so a drag never queues dozens of them.
 */
export function videoMedia() {
  let url
  let video
  let poster
  let pending

  function settle() {
    if (pending != null && Math.abs(video.currentTime - pending) > 0.01) {
      video.currentTime = pending
      return
    }
    pending = undefined
    redraw()
  }

  function load(next) {
    url = next
    video?.pause()
    video?.removeAttribute('src')
    video = undefined
    poster = undefined
    pending = undefined
    if (!next) return
    video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    for (const event of ['loadedmetadata', 'loadeddata', 'pause']) video.addEventListener(event, redraw)
    video.addEventListener('seeked', settle)
    video.src = next
  }

  function capture() {
    const scale = Math.min(1, POSTER_MAX_WIDTH / video.videoWidth)
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)
    if (!poster || poster.width !== width || poster.height !== height) {
      poster = document.createElement('canvas')
      poster.width = width
      poster.height = height
    }
    poster.getContext('2d').drawImage(video, 0, 0, width, height)
  }

  return {
    source(next) {
      if (next !== url) load(next)
      return this
    },
    get element() {
      return video
    },
    /** Size and duration, available from metadata on and stable through seeks. */
    get meta() {
      if (!video || video.readyState < 1 || !(video.videoWidth > 0)) return undefined
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
    },
    get loading() {
      return !!video && !this.meta
    },
    /** The current frame, or the last one decoded while a seek is pending. */
    get frame() {
      if (!video) return undefined
      if (video.readyState >= 2 && !video.seeking && pending == null) {
        capture()
        return video
      }
      return poster
    },
    get time() {
      return pending ?? video?.currentTime ?? 0
    },
    seek(time) {
      if (!this.meta) return
      pending = time
      if (!video.seeking) settle()
    }
  }
}
