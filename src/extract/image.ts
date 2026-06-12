/** Downscale a photo to the model's useful resolution and re-encode as JPEG
 *  base64. Phone photos are often 12MP+; beyond ~1568px on the long edge the
 *  API downsamples anyway, so sending more is pure upload cost. */
export async function fileToJpegBase64(file: File, maxEdge = 1568): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return dataUrl.slice(dataUrl.indexOf(',') + 1)
  } finally {
    bitmap.close()
  }
}
