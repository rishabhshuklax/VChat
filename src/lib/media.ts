/**
 * Camera, microphone, and screen capture.
 *
 * Everything here is written to degrade rather than fail: a laptop with no
 * camera, a denied permission, or a device that disappears mid-call should all
 * leave you in the room with whatever media you do have.
 */

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export interface DeviceList {
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
  speakers: MediaDeviceOption[];
}

export type MediaErrorKind =
  'permission-denied' | 'not-found' | 'in-use' | 'insecure-context' | 'unsupported' | 'unknown';

export class MediaError extends Error {
  readonly kind: MediaErrorKind;

  constructor(kind: MediaErrorKind, message: string) {
    super(message);
    this.name = 'MediaError';
    this.kind = kind;
  }
}

/** Browser-agnostic mapping of getUserMedia failures onto actionable copy. */
export function describeMediaError(error: unknown): MediaError {
  if (!window.isSecureContext) {
    return new MediaError(
      'insecure-context',
      'Camera and microphone access needs a secure (https) connection.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return new MediaError(
      'unsupported',
      'This browser does not support camera and microphone access.',
    );
  }
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new MediaError(
          'permission-denied',
          'Permission was denied. Allow camera and microphone access in your browser, then try again.',
        );
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new MediaError('not-found', 'No matching camera or microphone was found.');
      case 'NotReadableError':
      case 'AbortError':
        return new MediaError(
          'in-use',
          'Your camera or microphone is already in use by another app.',
        );
      default:
        break;
    }
  }
  return new MediaError('unknown', 'Could not start your camera or microphone.');
}

export interface MediaRequest {
  audio: boolean;
  video: boolean;
  cameraId?: string | undefined;
  microphoneId?: string | undefined;
}

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
};

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Requests a local stream.
 *
 * Asking for audio and video together means one denied device costs you both,
 * so each is requested separately and the results are merged. Someone with a
 * broken webcam still joins with working audio.
 */
export async function acquireLocalMedia(request: MediaRequest): Promise<{
  stream: MediaStream;
  errors: MediaError[];
}> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw describeMediaError(new Error('unsupported'));
  }

  const stream = new MediaStream();
  const errors: MediaError[] = [];

  if (request.audio) {
    try {
      const audio = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...AUDIO_CONSTRAINTS,
          ...(request.microphoneId ? { deviceId: { exact: request.microphoneId } } : {}),
        },
      });
      for (const track of audio.getAudioTracks()) stream.addTrack(track);
    } catch (error) {
      errors.push(describeMediaError(error));
    }
  }

  if (request.video) {
    try {
      const video = await navigator.mediaDevices.getUserMedia({
        video: {
          ...VIDEO_CONSTRAINTS,
          ...(request.cameraId ? { deviceId: { exact: request.cameraId } } : {}),
        },
      });
      for (const track of video.getVideoTracks()) stream.addTrack(track);
    } catch (error) {
      errors.push(describeMediaError(error));
    }
  }

  return { stream, errors };
}

export async function acquireScreenShare(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new MediaError('unsupported', 'Screen sharing is not supported in this browser.');
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      // System audio where the platform offers it; harmless where it does not.
      audio: false,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new MediaError('permission-denied', 'Screen sharing was cancelled.');
    }
    throw describeMediaError(error);
  }
}

/**
 * Enumerates devices. Labels are blank until permission has been granted at
 * least once, so this is worth calling again after acquiring media.
 */
export async function listDevices(): Promise<DeviceList> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { cameras: [], microphones: [], speakers: [] };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();

  const pick = (kind: MediaDeviceKind, fallback: string): MediaDeviceOption[] =>
    devices
      .filter((device) => device.kind === kind)
      .map((device, index) => ({
        deviceId: device.deviceId,
        kind: device.kind,
        label: device.label || `${fallback} ${index + 1}`,
      }));

  return {
    cameras: pick('videoinput', 'Camera'),
    microphones: pick('audioinput', 'Microphone'),
    speakers: pick('audiooutput', 'Speaker'),
  };
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}
