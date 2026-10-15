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
        java.io.File shared=PhoneStorage.file(uri);if(shared!=null&&shared.isFile()){CachedFilesProvider.openShared(context,shared);return new JSONObject().put("opened",true);}
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
    String type;try{java.io.File shared=PhoneStorage.file(uri);type=shared==null?context.getContentResolver().getType(uri):android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(android.webkit.MimeTypeMap.getFileExtensionFromUrl(shared.getName()).toLowerCase(java.util.Locale.ROOT));}catch(Exception e){type=null;}
    return type == null ? "*/*" : type;
  }

  JSONObject stat(Uri uri) throws Exception {
    java.io.File shared=PhoneStorage.file(uri);if(shared!=null&&shared.exists())return new JSONObject().put("name",shared.getName()).put("size",shared.isFile()?shared.length():JSONObject.NULL).put("mime",mime(uri));
    String name = uri.getLastPathSegment(); Object size = JSONObject.NULL;
    try (Cursor cursor = context.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        if (!cursor.isNull(0)) name = cursor.getString(0);
        if (!cursor.isNull(1)) size = cursor.getLong(1);
      }
    }
    return new JSONObject().put("name", name == null ? "File" : name).put("size", size).put("mime", mime(uri));
  }

  /** A phone document as a preview source (PDFs and media included; see PhonePreview). */
  PhonePreview.Source source(Uri uri) throws Exception {
    java.io.File shared=PhoneStorage.file(uri);if(shared!=null&&shared.isFile())return PhonePreview.file(shared,shared.getName());
    JSONObject entry = stat(uri);
    String name = entry.getString("name"), type = mime(uri); long size = entry.optLong("size", -1);
    return new PhonePreview.Source() {
      public String name() { return name; }
      public String mime() { return type; }
      public long size() { return size; }
      public PhonePreview.Stream open(long offset) throws Exception {
        InputStream input = context.getContentResolver().openInputStream(uri);
        if (input == null) throw new IOException("The file could not be read.");
        long skipped = 0; while (skipped < offset) { long n = input.skip(offset - skipped); if (n <= 0) break; skipped += n; }
        return new PhonePreview.Stream(input, skipped, size, () -> { try { input.close(); } catch (IOException ignored) {} });
      }
      public android.os.ParcelFileDescriptor descriptor() throws Exception { return context.getContentResolver().openFileDescriptor(uri, "r"); }
    };
  }
  private JSONObject preview(Uri uri) throws Exception { return PhonePreview.preview(source(uri)); }
}
