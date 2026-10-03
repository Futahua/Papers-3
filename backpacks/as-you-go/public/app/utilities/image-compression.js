function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

/** Downsizes and re-encodes an image so it is safe to store as a shortcut
 * or folder icon: no larger than 512px on its longest side and no more than
 * ~500KB. Small images pass through as-is. */
export async function compressIconFile(file) {
  const maximumDimension = 512;
  const targetBytes = 500_000;
  const bitmap = await createImageBitmap(file);
  try {
    if (
      file.size <= targetBytes
      && bitmap.width <= maximumDimension
      && bitmap.height <= maximumDimension
    ) {
      return readAsDataUrl(file);
    }

    const initialScale = Math.min(
      1,
      maximumDimension / Math.max(bitmap.width, bitmap.height),
    );
    let width = Math.max(1, Math.round(bitmap.width * initialScale));
    let height = Math.max(1, Math.round(bitmap.height * initialScale));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image compression is unavailable.');

    for (let sizeAttempt = 0; sizeAttempt < 5; sizeAttempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.9, 0.78, 0.65, 0.5]) {
        const compressed = await canvasBlob(canvas, quality);
        if (compressed && compressed.size <= targetBytes) {
          return readAsDataUrl(compressed);
        }
      }
      width = Math.max(32, Math.round(width * 0.75));
      height = Math.max(32, Math.round(height * 0.75));
    }
    throw new Error('That image could not be compressed enough for an icon.');
  } finally {
    bitmap.close();
  }
}
