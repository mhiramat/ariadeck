import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export interface CapturedImage {
  localUri: string;
  mimeType: string;
  fileSize: number;
}

export interface CapturedAudio {
  localUri: string;
  mimeType: string;
  fileSize: number;
  durationMs: number;
  transcript: string | null;
}

/**
 * Captures an image from the native Android camera/gallery via @capacitor/camera
 * when running on a Capacitor platform, or falls back to a file picker in web preview.
 */
export async function captureImageFromCameraOrGallery(): Promise<CapturedImage | null> {
  if (Capacitor.isNativePlatform()) {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt,
    });
    if (!photo.dataUrl) return null;
    const format = photo.format || 'jpeg';
    return {
      localUri: photo.dataUrl,
      mimeType: `image/${format}`,
      fileSize: Math.round((photo.dataUrl.length * 3) / 4),
    };
  }

  // Browser fallback using a hidden file input
  return new Promise<CapturedImage | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          localUri: String(reader.result ?? ''),
          mimeType: file.type || 'image/png',
          fileSize: file.size,
        });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

/**
 * Encapsulates microphone audio recording with optional Web Speech API
 * transcription for mobile voice notes.
 */
export class VoiceMemoRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone recording is not supported in this environment.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.startedAt = Date.now();
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.mediaRecorder.start();
  }

  async stop(): Promise<CapturedAudio> {
    const recorder = this.mediaRecorder;
    if (!recorder) {
      throw new Error('Voice recorder has not been started.');
    }
    const durationMs = Math.max(0, Date.now() - this.startedAt);

    return new Promise<CapturedAudio>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        const reader = new FileReader();
        reader.onload = () => {
          this.cleanup();
          resolve({
            localUri: String(reader.result ?? ''),
            mimeType,
            fileSize: blob.size,
            durationMs,
            transcript: null,
          });
        };
        reader.readAsDataURL(blob);
      };
      recorder.stop();
    });
  }

  private cleanup(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.chunks = [];
  }
}
