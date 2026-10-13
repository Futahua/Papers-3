package com.futahua.papers.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class CachedFilesProvider extends ContentProvider {
  static void open(Context context, File file, String name) {
    Uri uri = new Uri.Builder().scheme("content").authority("com.futahua.papers.mobile.files").appendPath(file.getName().replace(".bin", "")).appendQueryParameter("name", name).build();
    Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, type(name)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    context.startActivity(intent);
  }
  static void edit(Context context, String id, String name) {
    Uri uri = new Uri.Builder().scheme("content").authority("com.futahua.papers.mobile.files").appendPath("edit").appendPath(id).appendQueryParameter("name", name).build();
    Intent intent = new Intent(Intent.ACTION_EDIT).setDataAndType(uri, type(name)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    context.startActivity(intent);
  }
  private boolean editable(Uri uri) { return uri.getPathSegments().size()==2 && "edit".equals(uri.getPathSegments().get(0)); }
  private static String type(String name) { int index = name.lastIndexOf('.'); String mime = index < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(index + 1).toLowerCase(java.util.Locale.ROOT)); return mime == null ? "application/octet-stream" : mime; }
  private String key(Uri uri) throws FileNotFoundException { String key = uri.getLastPathSegment(); if (key == null || !key.matches("[a-f0-9]{64}")) throw new FileNotFoundException(); return key; }
  private File file(Uri uri) throws FileNotFoundException {
    if(editable(uri)) {try{return new MobileEditCopies(getContext()).working(uri.getLastPathSegment());}catch(Exception error){throw new FileNotFoundException("Local working copy is unavailable");}}
    return new File(new File(getContext().getFilesDir(), "remote-files"), key(uri) + ".bin");
  }
  @Override public boolean onCreate() { return true; }
  @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    if(!editable(uri) && !"r".equals(mode))throw new FileNotFoundException("Read-only offline copy");
    if(!java.util.Arrays.asList("r","w","wt","wa","rw","rwt").contains(mode))throw new FileNotFoundException("Unsupported file mode");
    return ParcelFileDescriptor.open(file(uri), editable(uri)?ParcelFileDescriptor.parseMode(mode):ParcelFileDescriptor.MODE_READ_ONLY);
  }
  @Override public String getType(Uri uri) { return type(uri.getQueryParameter("name") == null ? "" : uri.getQueryParameter("name")); }
  @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
    try { MatrixCursor cursor = new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }); cursor.addRow(new Object[] { uri.getQueryParameter("name"), file(uri).length() }); return cursor; } catch (Exception error) { return null; }
  }
  @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
  @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
  @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
