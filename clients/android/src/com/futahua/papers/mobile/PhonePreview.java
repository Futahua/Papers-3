package com.futahua.papers.mobile;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Previews on the phone, in the shapes As you Go's preview panel renders: images and PDFs as one
 * image (PDF pages rendered by Android and stacked), text as text, audio and video as data for the
 * panel's player, anything else as none. */
final class PhonePreview {
  /** Something previewable: a phone document or a cached computer file. */
  interface Source {
    String name();
    String mime();
    long size(); // -1 when unknown
    /** Bytes from offset to the end. */
    Stream open(long offset) throws Exception;
    /** A file descriptor for Android's PDF renderer, or null when the bytes are not seekable here. */
    ParcelFileDescriptor descriptor() throws Exception;
  }
  static final class Stream {
    final InputStream input; final long offset, total; final Runnable close;
    Stream(InputStream input, long offset, long total, Runnable close) { this.input = input; this.offset = offset; this.total = total; this.close = close; }
  }

  private static final int MEDIA_BYTES = 25 * 1024 * 1024, TEXT_BYTES = 256 * 1024, IMAGE_EDGE = 1600, PDF_WIDTH = 1080, PDF_PAGES = 12, PDF_MAX_HEIGHT = 16000;

  static String mimeFor(String name, String declared) {
    if (declared != null && !declared.isEmpty() && !"*/*".equals(declared) && !"application/octet-stream".equals(declared)) return declared;
    String n = name.toLowerCase(Locale.ROOT), ext = n.contains(".") ? n.substring(n.lastIndexOf('.') + 1) : "";
    switch (ext) {
      case "pdf": return "application/pdf";
      case "jpg": case "jpeg": return "image/jpeg";
      case "png": return "image/png"; case "gif": return "image/gif"; case "webp": return "image/webp"; case "bmp": return "image/bmp"; case "heic": return "image/heic";
      case "mp4": case "m4v": return "video/mp4"; case "webm": return "video/webm"; case "mkv": return "video/x-matroska"; case "mov": return "video/quicktime"; case "3gp": return "video/3gpp";
      case "mp3": return "audio/mpeg"; case "m4a": case "aac": return "audio/mp4"; case "wav": return "audio/wav"; case "ogg": case "oga": return "audio/ogg"; case "flac": return "audio/flac"; case "opus": return "audio/ogg";
      case "txt": case "md": case "csv": case "log": case "ini": case "yaml": case "yml": return "text/plain";
      case "json": return "application/json"; case "js": case "ts": case "py": case "css": case "xml": case "html": case "htm": return "text/plain";
      default: return "application/octet-stream";
    }
  }
  static boolean isMedia(String mime) { return mime.startsWith("video/") || mime.startsWith("audio/"); }

  static JSONObject preview(Source source) throws Exception {
    String mime = mimeFor(source.name(), source.mime());
    if (isMedia(mime)) return media(source, mime);
    if ("application/pdf".equals(mime)) return pdf(source);
    if (mime.startsWith("image/")) return image(source);
    if (mime.startsWith("text/") || "application/json".equals(mime)) return text(source);
    return new JSONObject().put("kind", "none");
  }

  /** Audio and video go to the preview panel's player as data (WebView's player cannot be fed by the
   * app's own request hook), so they are previewed up to MEDIA_BYTES; larger ones have no preview. */
  static JSONObject media(Source source, String mime) throws Exception {
    if (source.size() > MEDIA_BYTES) return new JSONObject().put("kind", "none");
    byte[] bytes; Stream stream = source.open(0);
    try { bytes = readAll(stream.input, MEDIA_BYTES); } finally { stream.close.run(); }
    return new JSONObject().put("kind", mime.startsWith("video/") ? "video" : "audio").put("mime", mime)
      .put("dataUrl", "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
  }

  private static JSONObject image(Source source) throws Exception {
    byte[] bytes; Stream stream = source.open(0);
    try { bytes = readAll(stream.input, 64 * 1024 * 1024); } finally { stream.close.run(); }
    BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
    BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
    while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > IMAGE_EDGE * 2) options.inSampleSize *= 2;
    Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    if (bitmap == null) return new JSONObject().put("kind", "none");
    return jpeg(scale(bitmap, IMAGE_EDGE));
  }

  private static JSONObject pdf(Source source) throws Exception {
    ParcelFileDescriptor descriptor = source.descriptor();
    if (descriptor == null) return new JSONObject().put("kind", "none");
    List<Bitmap> pages = new ArrayList<>(); int height = 0;
    try (PdfRenderer renderer = new PdfRenderer(descriptor)) {
      for (int i = 0; i < Math.min(PDF_PAGES, renderer.getPageCount()) && height < PDF_MAX_HEIGHT; i++) {
        try (PdfRenderer.Page page = renderer.openPage(i)) {
          int width = PDF_WIDTH, pageHeight = Math.max(1, Math.round((float) page.getHeight() * width / page.getWidth()));
          Bitmap bitmap = Bitmap.createBitmap(width, pageHeight, Bitmap.Config.ARGB_8888);
          bitmap.eraseColor(Color.WHITE);
          page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
          pages.add(bitmap); height += pageHeight + (i > 0 ? 16 : 0);
        }
      }
    }
    if (pages.isEmpty()) return new JSONObject().put("kind", "none");
    Bitmap sheet = Bitmap.createBitmap(PDF_WIDTH, Math.min(height, PDF_MAX_HEIGHT + 2000), Bitmap.Config.RGB_565);
    sheet.eraseColor(Color.rgb(40, 44, 52));
    Canvas canvas = new Canvas(sheet); int y = 0;
    for (Bitmap page : pages) { canvas.drawBitmap(page, 0, y, null); y += page.getHeight() + 16; page.recycle(); }
    return jpeg(sheet);
  }

  private static JSONObject text(Source source) throws Exception {
    Stream stream = source.open(0); byte[] data; boolean eof;
    try { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; int count; eof = true;
      while ((count = stream.input.read(buffer)) >= 0) { bytes.write(buffer, 0, count); if (bytes.size() >= TEXT_BYTES) { eof = stream.input.read() < 0; break; } }
      data = bytes.toByteArray(); } finally { stream.close.run(); }
    int length = Math.min(data.length, TEXT_BYTES);
    return new JSONObject().put("kind", "text").put("text", new String(data, 0, length, StandardCharsets.UTF_8)).put("byteOffset", 0).put("nextOffset", length).put("eof", eof && length == data.length);
  }

  private static Bitmap scale(Bitmap bitmap, int edge) {
    float factor = Math.min(1f, (float) edge / Math.max(bitmap.getWidth(), bitmap.getHeight()));
    return factor < 1f ? Bitmap.createScaledBitmap(bitmap, Math.round(bitmap.getWidth() * factor), Math.round(bitmap.getHeight() * factor), true) : bitmap;
  }
  private static JSONObject jpeg(Bitmap bitmap) throws Exception {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 85, bytes);
    return new JSONObject().put("kind", "image").put("mime", "image/jpeg").put("width", bitmap.getWidth()).put("height", bitmap.getHeight())
      .put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
  }
  private static byte[] readAll(InputStream input, int limit) throws IOException {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[65536]; int count;
    while ((count = input.read(buffer)) >= 0) { bytes.write(buffer, 0, count); if (bytes.size() > limit) throw new IOException("File is too large to preview."); }
    return bytes.toByteArray();
  }

  /** A complete local file (a cached computer file). */
  static Source file(File file, String name) {
    return new Source() {
      public String name() { return name; }
      public String mime() { return null; }
      public long size() { return file.length(); }
      public Stream open(long offset) throws Exception {
        java.io.FileInputStream input = new java.io.FileInputStream(file); long skipped = 0; while (skipped < offset) { long n = input.skip(offset - skipped); if (n <= 0) break; skipped += n; }
        return new Stream(input, skipped, file.length(), () -> { try { input.close(); } catch (IOException ignored) {} });
      }
      public ParcelFileDescriptor descriptor() throws Exception { return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY); }
    };
  }
}
