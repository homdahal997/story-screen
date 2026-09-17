export type SceneAssemblyShotRole = "master" | "reviewed-closeup";

export interface BrowserSceneAssemblyShot {
  videoUrl: string;
  durationSeconds: number;
  role: SceneAssemblyShotRole;
  lineNumber: number;
  shotNumber: number;
}

/** Alias kept intentionally short for callers building an ordered shot list. */
export type SceneAssemblyShot = BrowserSceneAssemblyShot;

export type BrowserSceneAssemblyProgressPhase = "recording" | "complete";

export interface BrowserSceneAssemblyProgress {
  phase: BrowserSceneAssemblyProgressPhase;
  shotIndex: number;
  shotCount: number;
  lineNumber: number;
  shotNumber: number;
  role: SceneAssemblyShotRole;
  elapsedSeconds: number;
  totalDurationSeconds: number;
}

/** Alias for callers that do not need the browser-specific name. */
export type SceneAssemblyProgress = BrowserSceneAssemblyProgress;

export interface BrowserSceneAssemblyResult {
  blob: Blob;
  contentType: "video/webm";
  totalDurationSeconds: number;
  shotCount: number;
}

/** Alias for callers that do not need the browser-specific name. */
export type SceneAssemblyResult = BrowserSceneAssemblyResult;

const MAX_SHOTS = 12;
const MAX_SHOT_DURATION_SECONDS = 60;
const MAX_TOTAL_DURATION_SECONDS = 360;
const SOURCE_LOAD_TIMEOUT_MS = 30_000;
const RECORDER_STOP_TIMEOUT_MS = 2_000;

class BrowserSceneAssemblyError extends Error {
  constructor(message: string) {
    super(message.slice(0, 240));
    this.name = "BrowserSceneAssemblyError";
  }
}

function assemblyError(message: string): BrowserSceneAssemblyError {
  return new BrowserSceneAssemblyError(message);
}

function isSecureHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value !== value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function assertNotCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw assemblyError("Scene assembly was canceled.");
}

function emitProgress(
  callback: ((progress: BrowserSceneAssemblyProgress) => void) | undefined,
  progress: BrowserSceneAssemblyProgress
): void {
  if (!callback) return;
  try {
    callback(progress);
  } catch {
    // A review surface must not be able to interrupt an otherwise valid render.
  }
}

type TrackedTimers = Set<number>;

function setTrackedTimeout(
  timers: TrackedTimers,
  callback: () => void,
  delayMs: number
): number {
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    callback();
  }, delayMs);
  timers.add(timer);
  return timer;
}

function clearTrackedTimeout(timers: TrackedTimers, timer: number): void {
  window.clearTimeout(timer);
  timers.delete(timer);
}

function getCaptureStream(video: HTMLVideoElement): MediaStream {
  const capturableVideo = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const stream = capturableVideo.captureStream?.() || capturableVideo.mozCaptureStream?.();
  if (!stream) throw assemblyError("This browser cannot capture a video stream.");
  if (stream.getVideoTracks().length === 0) {
    throw assemblyError("The scene source did not provide a video track.");
  }
  return stream;
}

function getSupportedWebmMimeType(recorderConstructor: typeof MediaRecorder): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mimeType = candidates.find((candidate) => {
    try {
      return recorderConstructor.isTypeSupported(candidate);
    } catch {
      return false;
    }
  });
  if (!mimeType) throw assemblyError("This browser cannot record WebM video.");
  return mimeType;
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Track cleanup is best effort on browser shutdown paths.
    }
  }
}

function waitForVideoReady(
  video: HTMLVideoElement,
  videoUrl: string,
  signal: AbortSignal | undefined,
  timers: TrackedTimers
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: number | null = null;

    const cleanup = () => {
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
      if (timeoutId !== null) clearTrackedTimeout(timers, timeoutId);
    };

    const finish = (error?: BrowserSceneAssemblyError) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const handleReady = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish();
    };
    const handleError = () => finish(assemblyError("A scene source could not be loaded."));
    const handleAbort = () => finish(assemblyError("Scene assembly was canceled."));

    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
    signal?.addEventListener("abort", handleAbort, { once: true });
    timeoutId = setTrackedTimeout(timers, () => {
      finish(assemblyError("A scene source took too long to load."));
    }, SOURCE_LOAD_TIMEOUT_MS);

    try {
      video.src = videoUrl;
      video.load();
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) handleReady();
    } catch {
      finish(assemblyError("A scene source could not be loaded."));
    }
  });
}

export async function renderBrowserSceneAssembly(
  shots: readonly BrowserSceneAssemblyShot[],
  onProgress?: (progress: BrowserSceneAssemblyProgress) => void,
  signal?: AbortSignal
): Promise<BrowserSceneAssemblyResult> {
  assertNotCanceled(signal);

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw assemblyError("Scene assembly requires a browser window.");
  }
  if (typeof window.MediaRecorder === "undefined") {
    throw assemblyError("This browser does not support video recording.");
  }
  if (!Array.isArray(shots) || shots.length === 0 || shots.length > MAX_SHOTS) {
    throw assemblyError("The scene must contain between one and twelve ordered shots.");
  }

  let totalDurationSeconds = 0;
  for (const shot of shots) {
    if (!shot || typeof shot !== "object") {
      throw assemblyError("The ordered shot list is invalid.");
    }
    if (!isSecureHttpsUrl(shot.videoUrl)) {
      throw assemblyError("Every scene source must use a secure HTTPS URL.");
    }
    if (
      typeof shot.durationSeconds !== "number" ||
      !Number.isFinite(shot.durationSeconds) ||
      shot.durationSeconds <= 0 ||
      shot.durationSeconds > MAX_SHOT_DURATION_SECONDS
    ) {
      throw assemblyError("Every scene shot needs a positive bounded duration.");
    }
    if (shot.role !== "master" && shot.role !== "reviewed-closeup") {
      throw assemblyError("Every scene shot needs a supported role.");
    }
    if (
      typeof shot.lineNumber !== "number" ||
      !Number.isInteger(shot.lineNumber) ||
      shot.lineNumber < 1 ||
      shot.lineNumber > 99 ||
      typeof shot.shotNumber !== "number" ||
      !Number.isInteger(shot.shotNumber) ||
      shot.shotNumber < 1 ||
      shot.shotNumber > 99
    ) {
      throw assemblyError("Every scene shot needs a valid line and shot number.");
    }
    totalDurationSeconds += shot.durationSeconds;
  }
  if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds > MAX_TOTAL_DURATION_SECONDS) {
    throw assemblyError("The ordered scene duration is too long to record in the browser.");
  }

  const recorderConstructor = window.MediaRecorder;
  const mimeType = getSupportedWebmMimeType(recorderConstructor);
  const timers: TrackedTimers = new Set();
  const video = document.createElement("video");
  const recordedChunks: Blob[] = [];
  let captureStream: MediaStream | null = null;
  let mixedStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let mediaSource: MediaElementAudioSourceNode | null = null;
  let masterGain: GainNode | null = null;
  let audioDestination: MediaStreamAudioDestinationNode | null = null;
  let recorder: MediaRecorder | null = null;
  let recorderError: BrowserSceneAssemblyError | null = null;
  let recorderStopped = false;
  let recorderStopRequested = false;
  let resolveRecorderStopped: (() => void) | null = null;
  let rejectActiveWait: ((error: BrowserSceneAssemblyError) => void) | null = null;
  let recorderDataHandler: ((event: BlobEvent) => void) | null = null;
  let recorderStopHandler: (() => void) | null = null;
  let recorderErrorHandler: (() => void) | null = null;

  const recorderStoppedPromise = new Promise<void>((resolve) => {
    resolveRecorderStopped = resolve;
  });

  const waitForShotDuration = (durationSeconds: number): Promise<void> =>
    new Promise((resolve, reject) => {
      let settled = false;
      let timerId: number | null = null;
      const finish = (error?: BrowserSceneAssemblyError) => {
        if (settled) return;
        settled = true;
        if (timerId !== null) clearTrackedTimeout(timers, timerId);
        signal?.removeEventListener("abort", handleAbort);
        if (rejectActiveWait === rejectWithError) rejectActiveWait = null;
        if (error) reject(error);
        else resolve();
      };
      const rejectWithError = (error: BrowserSceneAssemblyError) => finish(error);
      const handleAbort = () => finish(assemblyError("Scene assembly was canceled."));
      rejectActiveWait = rejectWithError;
      signal?.addEventListener("abort", handleAbort, { once: true });
      timerId = setTrackedTimeout(timers, () => finish(), durationSeconds * 1000);
    });

  const stopRecorder = async (): Promise<void> => {
    if (!recorder || recorder.state === "inactive") return;
    recorderStopRequested = true;
    try {
      recorder.stop();
    } catch {
      recorderStopRequested = false;
      return;
    }
    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTrackedTimeout(timers, resolve, RECORDER_STOP_TIMEOUT_MS);
    });
    await Promise.race([recorderStoppedPromise, timeoutPromise]);
    if (timeoutId !== null) clearTrackedTimeout(timers, timeoutId);
  };

  try {
    video.preload = "auto";
    video.playsInline = true;
    video.controls = false;
    video.loop = true;
    video.style.position = "fixed";
    video.style.left = "-10000px";
    video.style.top = "0";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.setAttribute("aria-hidden", "true");
    video.crossOrigin = "anonymous";
    document.body.appendChild(video);

    await waitForVideoReady(video, shots[0].videoUrl, signal, timers);
    assertNotCanceled(signal);
    try {
      video.currentTime = 0;
    } catch {
      throw assemblyError("The first scene source could not be positioned.");
    }

    const AudioContextConstructor = window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw assemblyError("This browser cannot capture the scene audio track.");
    }

    try {
      audioContext = new AudioContextConstructor();
      mediaSource = audioContext.createMediaElementSource(video);
      masterGain = audioContext.createGain();
      audioDestination = audioContext.createMediaStreamDestination();
      mediaSource.connect(masterGain);
      masterGain.connect(audioDestination);
      await audioContext.resume();
    } catch {
      throw assemblyError("The scene audio track could not be prepared.");
    }

    captureStream = getCaptureStream(video);
    const videoTracks = captureStream.getVideoTracks();
    const audioTracks = audioDestination?.stream.getAudioTracks() || [];
    if (videoTracks.length === 0 || audioTracks.length === 0) {
      throw assemblyError("The scene did not provide the tracks needed for WebM recording.");
    }
    mixedStream = new MediaStream([...videoTracks, ...audioTracks]);

    try {
      recorder = new recorderConstructor(mixedStream, { mimeType });
    } catch {
      throw assemblyError("The browser could not start the WebM recorder.");
    }

    recorderDataHandler = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    };
    recorderStopHandler = () => {
      if (!recorderStopRequested) {
        recorderError = assemblyError("The browser recorder stopped unexpectedly.");
        rejectActiveWait?.(recorderError);
      }
      recorderStopped = true;
      resolveRecorderStopped?.();
    };
    recorderErrorHandler = () => {
      recorderError = assemblyError("The browser recorder stopped unexpectedly.");
      rejectActiveWait?.(recorderError);
    };
    recorder.addEventListener("dataavailable", recorderDataHandler);
    recorder.addEventListener("stop", recorderStopHandler);
    recorder.addEventListener("error", recorderErrorHandler);

    try {
      recorder.start();
    } catch {
      throw assemblyError("The browser could not start the WebM recorder.");
    }

    let elapsedSeconds = 0;
    for (let index = 0; index < shots.length; index += 1) {
      const shot = shots[index];
      assertNotCanceled(signal);
      if (index > 0) {
        video.pause();
        await waitForVideoReady(video, shot.videoUrl, signal, timers);
        try {
          video.currentTime = 0;
        } catch {
          throw assemblyError("A scene source could not be positioned.");
        }
      }
      if (recorderError) throw recorderError;
      if (!masterGain || !audioContext) throw assemblyError("The scene audio track is unavailable.");
      const gainValue = shot.role === "master" ? 0 : 1;
      masterGain.gain.cancelScheduledValues(audioContext.currentTime);
      masterGain.gain.setValueAtTime(gainValue, audioContext.currentTime);

      try {
        await video.play();
      } catch {
        throw assemblyError("A scene source could not start playing.");
      }
      if (recorderError) throw recorderError;

      emitProgress(onProgress, {
        phase: "recording",
        shotIndex: index + 1,
        shotCount: shots.length,
        lineNumber: shot.lineNumber,
        shotNumber: shot.shotNumber,
        role: shot.role,
        elapsedSeconds,
        totalDurationSeconds,
      });
      await waitForShotDuration(shot.durationSeconds);
      if (recorderError) throw recorderError;
      elapsedSeconds += shot.durationSeconds;
    }

    assertNotCanceled(signal);
    await stopRecorder();
    assertNotCanceled(signal);
    if (recorderError) throw recorderError;
    if (!recorderStopped || recordedChunks.length === 0) {
      throw assemblyError("The browser recorder did not produce a WebM file.");
    }

    const blob = new Blob(recordedChunks, { type: "video/webm" });
    if (blob.size === 0) throw assemblyError("The browser recorder produced an empty WebM file.");
    const lastShot = shots[shots.length - 1];
    emitProgress(onProgress, {
      phase: "complete",
      shotIndex: shots.length,
      shotCount: shots.length,
      lineNumber: lastShot.lineNumber,
      shotNumber: lastShot.shotNumber,
      role: lastShot.role,
      elapsedSeconds: totalDurationSeconds,
      totalDurationSeconds,
    });

    return {
      blob,
      contentType: "video/webm",
      totalDurationSeconds,
      shotCount: shots.length,
    };
  } catch (error) {
    if (signal?.aborted) throw new Error("Scene assembly was canceled.");
    if (error instanceof BrowserSceneAssemblyError) throw error;
    throw new Error("The browser could not assemble this scene.");
  } finally {
    if (rejectActiveWait) rejectActiveWait(assemblyError("Scene assembly ended."));
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();

    try {
      await stopRecorder();
    } catch {
      // Stop is best effort while cleaning up an interrupted render.
    }
    if (recorder) {
      if (recorderDataHandler) recorder.removeEventListener("dataavailable", recorderDataHandler);
      if (recorderStopHandler) recorder.removeEventListener("stop", recorderStopHandler);
      if (recorderErrorHandler) recorder.removeEventListener("error", recorderErrorHandler);
    }

    stopTracks(mixedStream);
    if (mixedStream !== captureStream) stopTracks(captureStream);
    if (audioDestination) stopTracks(audioDestination.stream);

    try {
      mediaSource?.disconnect();
    } catch {
      // Audio graph cleanup is best effort.
    }
    try {
      masterGain?.disconnect();
    } catch {
      // Audio graph cleanup is best effort.
    }
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // Audio context may already be closed by the browser.
      }
    }

    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    } catch {
      // Temporary element cleanup is best effort on page teardown.
    }
  }
}
