package com.futahua.papers.mobile;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** The phone's own files in its As you Go: documents chosen with Android's picker, kept by their
 * content:// address (read permission is persisted), described, previewed and opened here. */
final class PhoneUris {
  private static final int TEXT_PREVIEW_BYTES = 256 * 1024, IMAGE_EDGE = 1600;
  private final Context context;
  PhoneUris(Context context) { this.context = context; }

  static boolean handles(String operation) { return operation.startsWith("uri-"); }

  JSONObject call(JSONObject request) throws Exception {
    Uri uri = checked(request.getString("uri"));
    switch (request.getString("operation")) {
      case "uri-stat": return stat(uri);
      case "uri-preview": return preview(uri);
      case "uri-open": {
        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime(uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(Intent.createChooser(view, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return new JSONObject().put("opened", true);
      }
      default: throw new IOException("Not available on the phone.");
    }
  }

  /** A chosen document: keep read access across restarts and describe it. */
  JSONObject keep(Uri uri) throws Exception {
    try { context.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) { /* not persistable: works until restart */ }
    JSONObject entry = stat(uri);
    return new JSONObject().put("target", uri.toString()).put("name", entry.getString("name")).put("size", entry.opt("size"));
  }

  private static Uri checked(String text) throws IOException {
    Uri uri = Uri.parse(text);
    if (!"content".equals(uri.getScheme())) throw new IOException("Not a phone file.");
    return uri;
  }

  private String mime(Uri uri) {
    String type = context.getContentResolver().getType(uri);
    return type == null ? "*/*" : type;
  }

  JSONObject stat(Uri uri) throws Exception {
    String name = uri.getLastPathSegment(); Object size = JSONObject.NULL;
    try (Cursor cursor = context.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        if (!cursor.isNull(0)) name = cursor.getString(0);
        if (!cursor.isNull(1)) size = cursor.getLong(1);
      }
    }
    return new JSONObject().put("name", name == null ? "File" : name).put("size", size).put("mime", mime(uri));
  }

  private JSONObject preview(Uri uri) throws Exception {
    String type = mime(uri), name = stat(uri).getString("name").toLowerCase();
    if (type.startsWith("image/")) {
      BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
      try (InputStream input = context.getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(input, null, bounds); }
      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inSampleSize = 1; while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > IMAGE_EDGE * 2) options.inSampleSize *= 2;
      Bitmap bitmap; try (InputStream input = context.getContentResolver().openInputStream(uri)) { bitmap = BitmapFactory.decodeStream(input, null, options); }
      if (bitmap == null) return new JSONObject().put("kind", "none");
      float scale = Math.min(1f, (float) IMAGE_EDGE / Math.max(bitmap.getWidth(), bitmap.getHeight()));
      if (scale < 1f) bitmap = Bitmap.createScaledBitmap(bitmap, Math.round(bitmap.getWidth() * scale), Math.round(bitmap.getHeight() * scale), true);
      ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 85, bytes);
      return new JSONObject().put("kind", "image").put("mime", "image/jpeg").put("width", bitmap.getWidth()).put("height", bitmap.getHeight())
        .put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
    }
    if (type.startsWith("text/") || name.matches(".*\\.(txt|md|json|csv|log|js|ts|py|html|css|xml|ini|yaml|yml)$")) {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; boolean eof = true;
      try (InputStream input = context.getContentResolver().openInputStream(uri)) {
        int count; while ((count = input.read(buffer)) >= 0) { bytes.write(buffer, 0, count); if (bytes.size() >= TEXT_PREVIEW_BYTES) { eof = input.read() < 0; break; } }
      }
      byte[] data = bytes.toByteArray(); int length = Math.min(data.length, TEXT_PREVIEW_BYTES);
      return new JSONObject().put("kind", "text").put("text", new String(data, 0, length, StandardCharsets.UTF_8)).put("byteOffset", 0).put("nextOffset", length).put("eof", eof && length == data.length);
    }
    return new JSONObject().put("kind", "none");
  }
}
