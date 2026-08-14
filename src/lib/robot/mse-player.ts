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

/** Codecs to ask go2rtc for, narrowed to what this browser can actually play. */
function supportedCodecs(): string {
  const candidates = [
    'avc1.640029', // H.264 high
    'avc1.64002A',
    'avc1.4D401E', // H.264 main
    'avc1.42E01E', // H.264 baseline
    'hvc1.1.6.L93.B0',
    'mp4a.40.2', // AAC
    'opus',
  ];
  return candidates
    .filter((codec) =>
      MediaSource.isTypeSupported(
        `video/mp4; codecs="${codec}"`.replace("video/mp4", codec.startsWith("mp4a") || codec === "opus" ? "audio/mp4" : "video/mp4"),
      ),
    )
    .join(",");
}

export interface MsePlayer {
  close: () => void;
}

/**
 * Play `source` into `video` over MSE.
 *
 * @param onPlaying called once the first frame has actually decoded — not when
 *   the socket opens, which says nothing about whether media is arriving.
 */
export function playMse(
  video: HTMLVideoElement,
  wsUrl: string,
  onPlaying: () => void,
  onError: () => void,
): MsePlayer {
  let closed = false;
  const mediaSource = new MediaSource();
  video.src = URL.createObjectURL(mediaSource);
  video.playsInline = true;
  video.muted = true;

  let socket: WebSocket | null = null;
  let buffer: SourceBuffer | null = null;
  // Segments can arrive faster than the SourceBuffer accepts them; appending
  // while it is updating throws, so they queue.
  const queue: ArrayBuffer[] = [];

  const drain = () => {
    if (!buffer || buffer.updating || queue.length === 0) return;
    try {
      buffer.appendBuffer(queue.shift()!);
    } catch {
      // A full or stale buffer is recoverable by dropping what we could not
      // append; the next keyframe re-syncs the picture.
      queue.length = 0;
    }
  };

  mediaSource.addEventListener("sourceopen", () => {
    if (closed) return;
    URL.revokeObjectURL(video.src);

    socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      socket?.send(
        JSON.stringify({ type: "mse", value: supportedCodecs() }),
      );
    });

    socket.addEventListener("message", (event) => {
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
          buffer.addEventListener("updateend", drain);
        } catch {
          onError();
        }
        return;
      }

      queue.push(event.data as ArrayBuffer);
      drain();
    });

    socket.addEventListener("error", () => {
      if (!closed) onError();
    });
    socket.addEventListener("close", () => {
      if (!closed) onError();
    });
  });

  // "Playing" means a frame decoded, never merely that the socket opened.
  video.addEventListener("loadeddata", () => {
    if (!closed) onPlaying();
  }, { once: true });

  void video.play().catch(() => {
    // Autoplay can be refused until the user interacts; the element still
    // buffers, and the first interaction starts it.
  });

  return {
    close() {
      closed = true;
      try {
        socket?.close();
      } catch {
        // already gone
      }
      try {
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
      } catch {
        // nothing to end
      }
      video.removeAttribute("src");
      video.load();
    },
  };
}
