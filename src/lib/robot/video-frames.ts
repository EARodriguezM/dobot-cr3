// Deciding whether a video element is actually showing something.
//
// Every cheap signal lies. `ontrack` fires when the SDP answer is applied,
// before any media exists. `loadeddata` fires on metadata alone. go2rtc
// reporting a consumer only means somebody asked for the stream. All three
// have labelled a black rectangle EN VIVO in this app. The only signal that
// cannot lie is a frame reaching the compositor, so that is what this watches.

/**
 * Call `onFrame` for every frame the element paints, until the returned
 * function is called. Used both to latch "live" on the first frame and to
 * notice a picture that has frozen while bytes keep arriving.
 */
export function watchFrames(
  video: HTMLVideoElement,
  onFrame: () => void,
): () => void {
  let stopped = false;

  const withCallback = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };

  // Chrome and Safari can answer the question directly: this fires once per
  // frame presented, and keeps firing even when the element is hidden.
  if (typeof withCallback.requestVideoFrameCallback === "function") {
    let handle = withCallback.requestVideoFrameCallback(function next() {
      if (stopped) return;
      handle = withCallback.requestVideoFrameCallback!(next);
      onFrame();
    });
    return () => {
      stopped = true;
      withCallback.cancelVideoFrameCallback?.(handle);
    };
  }

  // Firefox has no frame callback. A decoded frame size plus a clock that has
  // actually moved is the closest honest approximation available.
  let lastTime = -1;
  const check = () => {
    if (stopped || video.videoWidth === 0) return;
    if (video.currentTime === lastTime) return;
    lastTime = video.currentTime;
    onFrame();
  };
  video.addEventListener("timeupdate", check);
  return () => {
    stopped = true;
    video.removeEventListener("timeupdate", check);
  };
}
