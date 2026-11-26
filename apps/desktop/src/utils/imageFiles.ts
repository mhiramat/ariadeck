const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const SUPPORTED_IMAGE_EXT = /\.(jpe?g|png)$/i;

/**
 * Returns true if the given File/Blob appears to be a supported JPEG or PNG image.
 */
export function isSupportedImageFile(file: File): boolean {
  if (SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return true;
  }
  return SUPPORTED_IMAGE_EXT.test(file.name);
}

/**
 * Filters a FileList or File[] down to supported JPEG/PNG images.
 */
export function filterSupportedImageFiles(files: FileList | File[] | null | undefined): File[] {
  if (!files) return [];
  return Array.from(files).filter(isSupportedImageFile);
}

/**
 * Derives a clean default card title from an image filename (stripping extension).
 */
export function titleFromImageFilename(filename: string, fallback = 'Image Card'): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || fallback;
}

/**
 * Formats byte size into a human-readable string (e.g. "128 KB").
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
