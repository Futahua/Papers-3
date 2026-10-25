package com.futahua.papers.mobile;

import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import org.json.JSONObject;

/** Custom pictures of the phone's own files and folders (desktop: src/main/backpacks/customIconStore.ts),
 * kept here so computers browsing the phone see them too. Keyed by canonical path; a renamed or moved
 * item loses its picture. */
final class PhoneCustomIcons {
  private static final int MAX_BYTES = 256 * 1024, MAX_ICONS = 4000;
  private static final String ICON = "data:image/(png|jpeg|webp|gif|svg\\+xml|x-icon|vnd\\.microsoft\\.icon|bmp|avif);base64,[A-Za-z0-9+/=]+";
  private static PhoneCustomIcons instance;
  private final AtomicFile file;
  private JSONObject icons;
  private PhoneCustomIcons(Context context) { file = new AtomicFile(new File(context.getFilesDir(), "custom-icons.json")); }
  static synchronized PhoneCustomIcons get(Context context) { if (instance == null) instance = new PhoneCustomIcons(context.getApplicationContext()); return instance; }

  static String valid(Object value) throws IOException {
    if (value == null || value == JSONObject.NULL) return null;
    String icon = String.valueOf(value);
    if (icon.length() > MAX_BYTES || !icon.matches(ICON)) throw new IOException("The picture must be a small image.");
    return icon;
  }
  private JSONObject load() {
    if (icons != null) return icons;
    try { icons = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8)); } catch (Exception e) { icons = new JSONObject(); }
    return icons;
  }
  /** Pictures of the direct children of `folder`, by child name. */
  synchronized JSONObject inFolder(File folder) throws Exception {
    String parent = folder.getCanonicalPath();
    JSONObject out = new JSONObject(), all = load();
    for (Iterator<String> keys = all.keys(); keys.hasNext();) {
      String key = keys.next(); File item = new File(key);
      if (item.getParent() != null && item.getParent().equals(parent)) out.put(item.getName(), all.getString(key));
    }
    return out;
  }
  synchronized void set(File item, Object value) throws Exception {
    String icon = valid(value), key = item.getCanonicalPath();
    JSONObject all = load();
    if (icon == null) all.remove(key); else all.put(key, icon);
    if (all.length() > MAX_ICONS) { all.remove(key); throw new IOException("Too many custom pictures on this phone."); }
    FileOutputStream stream = file.startWrite();
    try { stream.write(all.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(stream); } catch (Exception e) { file.failWrite(stream); throw e; }
  }
}
