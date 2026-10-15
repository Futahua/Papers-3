package com.futahua.papers.mobile;
import android.os.Environment;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.*;
import java.io.*;
import java.util.*;

/** Shared-storage references for As you Go, independent of either computer's filesystem. */
final class PhoneStorage {
  static List<File> roots() {
    List<File> result = new ArrayList<>(); File internal = Environment.getExternalStorageDirectory();
    if (internal.canRead()) result.add(internal);
    File[] others = new File("/storage").listFiles();
    if (others != null) for (File file : others) if (!file.getName().equals("emulated") && !file.getName().equals("self") && file.isDirectory() && file.canRead()) result.add(file);
    return result;
  }
  static String name(File root) { return root.equals(Environment.getExternalStorageDirectory()) ? "Internal storage" : root.getName(); }
  static File file(Uri uri) throws Exception {
    if (!"content".equals(uri.getScheme()) || !"com.android.externalstorage.documents".equals(uri.getAuthority())) return null;
    String id = DocumentsContract.getDocumentId(uri); int colon = id.indexOf(':'); if (colon < 0) return null;
    for (File root : roots()) if ((root.equals(Environment.getExternalStorageDirectory()) ? "primary" : root.getName()).equals(id.substring(0, colon))) {
      File target = new File(root, id.substring(colon + 1)).getCanonicalFile(); String base = root.getCanonicalPath();
      if (!target.getPath().equals(base) && !target.getPath().startsWith(base + "/")) throw new IOException("Phone document is outside shared storage.");
      return target;
    }
    return null;
  }
  static String outward(String value) throws Exception {
    if(value.startsWith("\\\\papers~phone\\")) {
      String tail=value.substring("\\\\papers~phone\\".length());String decoded=Uri.decode(tail);
      if(decoded.startsWith("content://"))value=decoded;
      else{String[] parts=tail.split("\\\\",-1);if(parts.length==0)return value;StringBuilder id=new StringBuilder(Uri.decode(parts[0])).append(':');for(int i=1;i<parts.length;i++){if(i>1)id.append('/');id.append(Uri.decode(parts[i]));}value=DocumentsContract.buildDocumentUri("com.android.externalstorage.documents",id.toString()).toString();}
    }
    if (!value.startsWith("content://com.android.externalstorage.documents/")) return value;
    File target; try { target = file(Uri.parse(value)); } catch (IllegalArgumentException e) { return value; }
    if (target == null) return value;
    for (File root : roots()) { String base = root.getCanonicalPath(); if (target.getPath().equals(base) || target.getPath().startsWith(base + "/")) return name(root) + (target.getPath().equals(base) ? "" : "\\" + target.getPath().substring(base.length() + 1).replace('/', '\\')); }
    return value;
  }
  static String inward(String value) throws Exception {
    for (File root : roots()) { String name = name(root); if (value.equals(name) || value.startsWith(name + "\\")) {
      String relative = value.equals(name) ? "" : value.substring(name.length() + 1).replace('\\', '/');
      File target = new File(root, relative).getCanonicalFile(); String base = root.getCanonicalPath();
      if (!target.getPath().equals(base) && !target.getPath().startsWith(base + "/")) throw new IOException("Phone reference is outside shared storage.");
      String volume = root.equals(Environment.getExternalStorageDirectory()) ? "primary" : root.getName();
      StringBuilder result=new StringBuilder("\\\\papers~phone\\").append(Uri.encode(volume));for(String part:relative.split("/"))if(!part.isEmpty())result.append('\\').append(Uri.encode(part));return result.toString();
    } }
    return value;
  }
  static Object map(Object value, boolean outward) throws Exception {
    return map(value,outward,"");
  }
  private static Object map(Object value, boolean outward, String field) throws Exception {
    if (value instanceof String) return Arrays.asList("target","path","paths","destination","uri","resolvedTarget").contains(field) ? outward ? outward((String)value) : inward((String)value) : value;
    if (value instanceof JSONObject) { JSONObject result = new JSONObject(); Iterator<String> keys = ((JSONObject)value).keys(); while(keys.hasNext()) { String key = keys.next(); result.put(key, map(((JSONObject)value).get(key), outward,key)); } return result; }
    if (value instanceof JSONArray) { JSONArray result = new JSONArray(); for (int i=0;i<((JSONArray)value).length();i++) result.put(map(((JSONArray)value).get(i), outward,field)); return result; }
    return value;
  }
}
