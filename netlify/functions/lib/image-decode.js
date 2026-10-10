/**
 * Läser bilder (JPEG och PNG) till pixlar, utan inbyggda moduler. WebP och GIF ger bara mått.
 * Används för format- och färgkontrollerna i granskningen (Modul B).
 */
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const MAX_PIXELS = 40e6; // skydd mot orimligt stora bilder

export function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}

export const CONTENT_TYPES = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
export const EXTENSIONS = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };

// Mått utan avkodning (för WebP och GIF, och som snabb kontroll).
export function imageSize(buf) {
  const type = imageType(buf);
  if (type === 'png') return { type, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (type === 'gif') return { type, width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (type === 'webp') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type, width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type, width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { type, width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (type === 'jpeg') {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type, height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return { type, width: null, height: null };
}

// Pixlar som RGBA. Returnerar null för format som inte avkodas.
export function decodeImage(buf) {
  const size = imageSize(buf);
  if (!size.width || !size.height || size.width * size.height > MAX_PIXELS) return { ...size, data: null };
  if (size.type === 'jpeg') {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { type: 'jpeg', width: img.width, height: img.height, data: img.data };
  }
  if (size.type === 'png') {
    const img = PNG.sync.read(buf);
    return { type: 'png', width: img.width, height: img.height, data: img.data };
  }
  return { ...size, data: null };
}
