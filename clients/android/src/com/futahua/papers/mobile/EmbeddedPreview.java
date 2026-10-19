package com.futahua.papers.mobile;

import android.os.ParcelFileDescriptor;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.zip.Inflater;

/** Preview pictures Revit, AutoCAD and SketchUp store inside their files, read without those programs.
 * Same rules as ProximaCrossDeviceSource server/preview-extract.mjs (BOP and the web use that copy).
 * Only the needed parts are read, so a 300 MB model costs a few kilobytes. Returns PNG or BMP bytes. */
final class EmbeddedPreview {
  private EmbeddedPreview() {}

  static boolean supports(String name) {
    String ext = extension(name);
    return ext.equals(".rvt") || ext.equals(".rfa") || ext.equals(".rte") || ext.equals(".dwg") || ext.equals(".skp");
  }
  private static String extension(String name) {
    String n = String.valueOf(name).toLowerCase(Locale.ROOT);
    int dot = n.lastIndexOf('.');
    return dot < 0 ? "" : n.substring(dot);
  }

  /** Random reads: positional reads on a file descriptor when there is one, else a stream from the offset. */
  private static final class Reader implements AutoCloseable {
    final PhonePreview.Source source; final long size; ParcelFileDescriptor descriptor; FileInputStream input; FileChannel channel;
    Reader(PhonePreview.Source source) throws Exception {
      this.source = source;
      descriptor = source.descriptor();
      if (descriptor != null) { input = new FileInputStream(descriptor.getFileDescriptor()); channel = input.getChannel(); }
      long declared = source.size();
      size = declared >= 0 ? declared : channel != null ? channel.size() : -1;
    }
    byte[] read(long offset, int length) throws Exception {
      if (offset < 0 || length <= 0) return new byte[0];
      if (size >= 0) length = (int) Math.max(0, Math.min(length, size - offset));
      byte[] out = new byte[length]; int at = 0;
      if (channel != null) {
        ByteBuffer buffer = ByteBuffer.wrap(out);
        while (buffer.hasRemaining()) { int n = channel.read(buffer, offset + buffer.position()); if (n < 0) break; }
        at = buffer.position();
      } else {
        PhonePreview.Stream stream = source.open(offset);
        try { InputStream in = stream.input; int n; while (at < length && (n = in.read(out, at, length - at)) > 0) at += n; }
        finally { stream.close.run(); }
      }
      if (at == length) return out;
      byte[] trimmed = new byte[at]; System.arraycopy(out, 0, trimmed, 0, at); return trimmed;
    }
    @Override public void close() { try { if (input != null) input.close(); } catch (Exception ignored) {} try { if (descriptor != null) descriptor.close(); } catch (Exception ignored) {} }
  }

  static byte[] extract(PhonePreview.Source source) {
    String ext = extension(source.name());
    try (Reader reader = new Reader(source)) {
      if (reader.size < 0) return null;
      if (ext.equals(".dwg")) return dwg(reader);
      if (ext.equals(".skp")) return sketchup(reader);
      return revit(reader);
    } catch (Exception error) {
      return null;
    }
  }

  private static int u16(byte[] b, int o) { return (b[o] & 0xff) | ((b[o + 1] & 0xff) << 8); }
  private static long u32(byte[] b, int o) { return ((b[o] & 0xffL) | ((b[o + 1] & 0xffL) << 8) | ((b[o + 2] & 0xffL) << 16) | ((b[o + 3] & 0xffL) << 24)); }
  private static long be32(byte[] b, int o) { return ((b[o] & 0xffL) << 24) | ((b[o + 1] & 0xffL) << 16) | ((b[o + 2] & 0xffL) << 8) | (b[o + 3] & 0xffL); }
  private static final byte[] PNG = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};

  private static byte[] firstPng(byte[] bytes) {
    outer:
    for (int i = 0; i <= bytes.length - 8; i++) {
      for (int j = 0; j < 8; j++) if (bytes[i + j] != PNG[j]) continue outer;
      int o = i + 8;
      while (o + 12 <= bytes.length) {
        long length = be32(bytes, o); String type = new String(bytes, o + 4, 4, StandardCharsets.ISO_8859_1);
        if (length > bytes.length) break;
        o += 12 + (int) length;
        if (o > bytes.length) break;
        if (type.equals("IEND")) { byte[] png = new byte[o - i]; System.arraycopy(bytes, i, png, 0, png.length); return png; }
      }
    }
    return null;
  }

  // Revit: an OLE compound file whose "RevitPreview4.0" stream holds a PNG.
  private static byte[] revit(Reader r) throws Exception {
    byte[] h = r.read(0, 512);
    if (h.length < 512 || u32(h, 0) != 0xe011cfd0L || u32(h, 4) != 0xe11ab1a1L) return null;
    int sectorSize = 1 << u16(h, 0x1e); long fatSectors = u32(h, 0x2c), firstDir = u32(h, 0x30), cutoff = u32(h, 0x38);
    if (fatSectors > 1_000_000) return null;
    long[] difat = new long[(int) fatSectors]; int count = 0;
    for (int i = 0; i < 109 && count < fatSectors; i++) difat[count++] = u32(h, 0x4c + i * 4);
    for (long next = u32(h, 0x44), guard = 0; count < fatSectors && next < 0xfffffffaL && guard++ < 10000;) {
      byte[] d = r.read((next + 1) * sectorSize, sectorSize); int per = sectorSize / 4 - 1;
      for (int i = 0; i < per && count < fatSectors; i++) difat[count++] = u32(d, i * 4);
      next = u32(d, per * 4);
    }
    int perSector = sectorSize / 4; long[] fat = new long[count * perSector];
    for (int i = 0; i < count; i++) { byte[] s = r.read((difat[i] + 1) * sectorSize, sectorSize); for (int j = 0; j < perSector && j * 4 + 4 <= s.length; j++) fat[i * perSector + j] = u32(s, j * 4); }
    for (long s = firstDir, guard = 0; s < 0xfffffffaL && s < fat.length && guard++ < fat.length; s = fat[(int) s]) {
      byte[] dir = r.read((s + 1) * sectorSize, sectorSize);
      for (int e = 0; e + 128 <= dir.length; e += 128) {
        int nameLength = u16(dir, e + 0x40);
        if (nameLength < 2 || nameLength > 64) continue;
        String name = new String(dir, e, nameLength - 2, StandardCharsets.UTF_16LE);
        if (!name.equals("RevitPreview4.0")) continue;
        long start = u32(dir, e + 0x74), length = u32(dir, e + 0x78);
        if (length < cutoff || length > 32L * 1024 * 1024) return null;
        ByteArrayOutputStream out = new ByteArrayOutputStream((int) length);
        for (long c = start, g = 0; c < 0xfffffffaL && c < fat.length && out.size() < length && g++ < fat.length; c = fat[(int) c])
          out.write(r.read((c + 1) * sectorSize, (int) Math.min(sectorSize, length - out.size())));
        return firstPng(out.toByteArray());
      }
    }
    return null;
  }

  // AutoCAD: offset 0x0D points to a preview section listing its pictures (PNG from 2013, BMP before).
  private static byte[] dwg(Reader r) throws Exception {
    byte[] h = r.read(0, 0x20);
    if (h.length < 0x20 || !new String(h, 0, 6, StandardCharsets.ISO_8859_1).matches("AC10\\d\\d")) return null;
    long at = u32(h, 0x0d);
    if (at == 0 || at + 0x40 > r.size) return null;
    byte[] head = r.read(at, 0x60);
    int count = head[20] & 0xff;
    for (int i = 0, o = 21; i < count && o + 9 <= head.length; i++, o += 9) {
      int code = head[o] & 0xff; long start = u32(head, o + 1), length = u32(head, o + 5);
      if (length == 0 || start + length > r.size || length > 16L * 1024 * 1024) continue;
      if (code == 6) { byte[] png = firstPng(r.read(start, (int) length)); if (png != null) return png; }
      if (code == 2) {
        byte[] dib = r.read(start, (int) length);
        long headerSize = u32(dib, 0); int bits = u16(dib, 14); long colors = u32(dib, 32); if (colors == 0 && bits <= 8) colors = 1L << bits;
        long pixels = 14 + headerSize + colors * 4; byte[] file = new byte[14 + dib.length];
        file[0] = 'B'; file[1] = 'M'; ByteBuffer.wrap(file).order(java.nio.ByteOrder.LITTLE_ENDIAN).putInt(2, file.length).putInt(10, (int) pixels);
        System.arraycopy(dib, 0, file, 14, dib.length);
        return file;
      }
    }
    return null;
  }

  // SketchUp: from 2021 a zip (after a short header) holding meta/preview_thumbnail.png; earlier files keep
  // the thumbnail PNG near their start.
  private static byte[] sketchup(Reader r) throws Exception {
    int tailLength = (int) Math.min(r.size, 65536 + 22); byte[] tail = r.read(r.size - tailLength, tailLength);
    int eocd = -1;
    for (int i = tail.length - 22; i >= 0; i--) if (u32(tail, i) == 0x06054b50L) { eocd = i; break; }
    if (eocd >= 0) {
      long dirSize = u32(tail, eocd + 12), dirOffset = u32(tail, eocd + 16), dirStart = r.size - tailLength + eocd - dirSize, shift = dirStart - dirOffset;
      byte[] dir = r.read(dirStart, (int) dirSize);
      for (int o = 0; o + 46 <= dir.length && u32(dir, o) == 0x02014b50L;) {
        int method = u16(dir, o + 10), nameLength = u16(dir, o + 28), extra = u16(dir, o + 30), comment = u16(dir, o + 32);
        long compressed = u32(dir, o + 20), uncompressed = u32(dir, o + 24), local = u32(dir, o + 42) + shift;
        String name = new String(dir, o + 46, nameLength, StandardCharsets.UTF_8);
        if ((name.equals("meta/preview_thumbnail.png") || name.equals("meta/model_thumbnail.png")) && compressed <= 32L * 1024 * 1024 && uncompressed <= 64L * 1024 * 1024) {
          byte[] lh = r.read(local, 30), data = r.read(local + 30 + u16(lh, 26) + u16(lh, 28), (int) compressed);
          if (method == 0) return firstPng(data);
          if (method == 8) {
            Inflater inflater = new Inflater(true);
            try { inflater.setInput(data); byte[] out = new byte[(int) uncompressed]; int n = inflater.inflate(out); return n == out.length ? firstPng(out) : null; }
            finally { inflater.end(); }
          }
          return null;
        }
        o += 46 + nameLength + extra + comment;
      }
    }
    return firstPng(r.read(0, (int) Math.min(r.size, 8L * 1024 * 1024)));
  }
}
