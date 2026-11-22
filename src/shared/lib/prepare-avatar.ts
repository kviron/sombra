export async function prepareAvatar(file: File) {
 if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
  throw new Error('Выберите PNG, JPEG или WebP до 5 МБ');
 }
 const bitmap = await createImageBitmap(file);
 try {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось прочитать изображение');
  const size = Math.min(bitmap.width, bitmap.height);
  context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
  return canvas.toDataURL('image/png');
 } finally {
  bitmap.close();
 }
}
