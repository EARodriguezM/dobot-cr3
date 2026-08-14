// go2rtc's MSE-over-WebSocket player: video that does not need ICE.
//
// WebRTC is the fast path and the right default — sub-second, peer to peer.
// But it needs a UDP path between the browser and the lab computer, and on a
// university network behind a Cloudflare Tunnel there frequently is not one:
// the SDP exchange succeeds over HTTPS and then ICE quietly fails, leaving a
// black rectangle and no error anywhere.
//
// This is the fallback the platform architecture always called for. It carries
// fragmented MP4 over the same authenticated WebSocket path the rest of the
// lab uses, so it works exactly wherever the tunnel works. The trade is
// latency — buffered rather than real-time — which is why it is the fallback
// and not the default.

import { watchFrames } from "./video-frames";

/** Seconds of played-out media to keep behind the live edge before evicting. */
const KEEP_SECONDS = 10;
/** How far playback may drift behind the live edge before it is pulled back. */
const MAX_LAG_SECONDS = 3;
/** How long media may stop arriving, or stop painting, before this is a fault. */
const STALL_MS = 12_000;

/** Codecs to ask go2rtc for, narrowed to what this browser can actually play. */
function supportedCodecs(): string {
  const candidates: [mime: string, codec: string][] = [
    ['video/mp4; codecs="avc1.640029"', "avc1.640029"], // H.264 high
    ['video/mp4; codecs="avc1.64002A"', "avc1.64002A"],
    ['video/mp4; codecs="avc1.4D401E"', "avc1.4D401E"], // H.264 main
    ['video/mp4; codecs="avc1.42E01E"', "avc1.42E01E"], // H.264 baseline
    ['video/mp4; codecs="hvc1.1.6.L93.B0"', "hvc1.1.6.L93.B0"],
    ['audio/mp4; codecs="mp4a.40.2"', "mp4a.40.2"], // AAC
    ['audio/mp4; codecs="opus"', "opus"],
  ];
  return candidates
    .filter(([mime]) => MediaSource.isTypeSupported(mime))
    .map(([, codec]) => codec)
    .join(",");
}

export interface MsePlayer {
  close: () => void;
}

/**
 * Play `source` into `video` over MSE.
 *
 * @param onPlaying called once a frame has actually been painted — not when
 *   the socket opens, and not on `loadeddata`, neither of which says anything
 *   about whether a picture exists.
 */
export function playMse(
  video: HTMLVideoElement,
  wsUrl: string,
  onPlaying: () => void,
  onError: () => void,
): MsePlayer {
  if (typeof MediaSource === "undefined") {
    // Older iOS Safari has no MediaSource at all. Report it rather than
    // throwing out of the caller's effect.
    onError();
    return { close: () => {} };
  }

  let closed = false;
  let failed = false;
  let playing = false;
  let socket: WebSocket | null = null;
  let buffer: SourceBuffer | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let stopFrames: (() => void) | null = null;

  // Segments can arrive faster than the SourceBuffer accepts them; appending
  // while it is updating throws, so they queue.
  const queue: ArrayBuffer[] = [];
  // Every listener below is registered against this, so teardown cannot leave
  // a stale handler on a <video> element that outlives this player.
  const listeners = new AbortController();
  const signal = listeners.signal;

  const startedAt = Date.now();
  let lastByteAt = startedAt;
  let lastFrameAt = 0;

  const teardown = () => {
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
    stopFrames?.();
    stopFrames = null;
    listeners.abort();
    try {
      socket?.close();
    } catch {
      // already gone
    }
    socket = null;
    queue.length = 0;
  };

  const fail = () => {
    if (closed || failed) return;
    failed = true;
    teardown();
    onError();
  };

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);

  // A MediaStream left on `srcObject` overrides `src` entirely: the
  // MediaSource never attaches, `sourceopen` never fires, and everything below
  // simply never runs — no socket, no bytes, no error, just black. WebRTC
  // leaves one behind whenever it fails, which is precisely when this player
  // gets used, so clear it before claiming the element.
  video.srcObject = null;
  video.src = objectUrl;
  video.playsInline = true;
  video.muted = true;

  /** Drop buffered media far enough behind the live edge to be useless. */
  const evict = (keepSeconds: number): boolean => {
    if (!buffer || buffer.updating || buffer.buffered.length === 0) return false;
    const start = buffer.buffered.start(0);
    const end = buffer.buffered.end(buffer.buffered.length - 1);
    // Never remove the frame currently on screen.
    const cut = Math.min(end - keepSeconds, video.currentTime - 1);
    if (cut <= start) return false;
    try {
      buffer.remove(start, cut);
      return true;
    } catch {
      return false;
    }
  };

  /** Keep playback pinned to the live edge. */
  const resync = () => {
    if (!buffer || buffer.updating || buffer.buffered.length === 0) return;
    const start = buffer.buffered.start(0);
    const end = buffer.buffered.end(buffer.buffered.length - 1);
    // A stream whose first segment does not start at zero — or one whose head
    // has just been evicted — leaves currentTime outside every buffered range.
    // The element then holds plenty of media and paints none of it.
    if (video.currentTime < start || end - video.currentTime > MAX_LAG_SECONDS) {
      video.currentTime = Math.max(start, end - 0.5);
    }
  };

  const drain = () => {
    if (!buffer || buffer.updating) return;

    const segment = queue.shift();
    if (!segment) {
      // Idle: the moment to garbage-collect. Left alone this buffer grows
      // without limit — 77 MB in two and a half minutes on the bench camera —
      // until appendBuffer starts throwing partway through a class.
      if (!evict(KEEP_SECONDS)) resync();
      return;
    }

    try {
      buffer.appendBuffer(segment);
    } catch (error) {
      if (
        (error as DOMException)?.name === "QuotaExceededError" &&
        evict(KEEP_SECONDS / 2)
      ) {
        // Full, not broken: keep the segment and let the `updateend` from the
        // eviction retry it.
        queue.unshift(segment);
        return;
      }
      // Anything else means this segment cannot be decoded. Drop the backlog
      // and let the next keyframe re-sync the picture.
      queue.length = 0;
    }
  };

  mediaSource.addEventListener(
    "sourceopen",
    () => {
      URL.revokeObjectURL(objectUrl);
      if (closed) return;

      socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";

      socket.addEventListener(
        "open",
        () => socket?.send(JSON.stringify({ type: "mse", value: supportedCodecs() })),
        { signal },
      );

      socket.addEventListener(
        "message",
        (event) => {
          if (closed) return;

          if (typeof event.data === "string") {
            // go2rtc replies with the exact mime type it will send.
            let message: { type?: string; value?: string };
            try {
              message = JSON.parse(event.data);
            } catch {
              return;
            }
            if (message.type !== "mse" || !message.value) return;
            try {
              buffer = mediaSource.addSourceBuffer(message.value);
              buffer.mode = "segments";
              buffer.addEventListener("updateend", drain, { signal });
              buffer.addEventListener("error", fail, { signal });
            } catch {
              fail();
            }
            return;
          }

          lastByteAt = Date.now();
          queue.push(event.data as ArrayBuffer);
          drain();
        },
        { signal },
      );

      socket.addEventListener("error", fail, { signal });
      socket.addEventListener("close", fail, { signal });
    },
    { once: true, signal },
  );

  video.addEventListener("error", fail, { signal });

  stopFrames = watchFrames(video, () => {
    lastFrameAt = Date.now();
    if (playing || closed) return;
    playing = true;
    onPlaying();
  });

  void video.play().catch(() => {
    // Autoplay can be refused until the user interacts; the watchdog retries.
  });

  // Neither the socket nor the decoder reports the failure that actually
  // matters here: media arriving and nothing appearing. Watch the two things
  // that have to keep happening, rather than trusting that they do.
  watchdog = setInterval(() => {
    if (closed || failed) return;
    const now = Date.now();
    if (now - lastByteAt > STALL_MS) {
      fail();
      return;
    }
    if (video.paused) {
      // Autoplay refused, or a seek that did not resume. Muted inline playback
      // is permitted everywhere, so this normally succeeds immediately — and
      // a paused element is not a broken stream, so it is not a failure.
      void video.play().catch(() => {});
      return;
    }
    if (now - (lastFrameAt || startedAt) > STALL_MS) fail();
  }, 2000);

  return {
    close() {
      closed = true;
      teardown();
      try {
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
      } catch {
        // nothing to end
      }
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    },
  };
}
