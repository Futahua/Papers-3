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
      case "uri-thumbnail":return thumbnail(uri);
      case "uri-icon":return new JSONObject().put("icon",appIcon(uri));
      case "uri-reveal": return reveal(uri);
      case "uri-storage-path": {java.io.File file=sharedFile(uri);if(file==null||!file.exists())throw new IOException("This document has no accessible Android storage location.");return new JSONObject().put("uri",storageUri(file).toString()).put("name",file.getName());}
      case "uri-open": {
        java.io.File shared=PhoneStorage.file(uri);if(shared!=null&&shared.isFile()){CachedFilesProvider.openShared(context,shared);return new JSONObject().put("opened",true);}
        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime(uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(Intent.createChooser(view, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return new JSONObject().put("opened", true);
      }
      default: throw new IOException("Not available on the phone.");
    }
  }

  private java.io.File sharedFile(Uri uri)throws Exception {
    java.io.File file=PhoneStorage.file(uri);Uri media=uri;
    if(file==null){
      if("com.android.providers.media.documents".equals(uri.getAuthority())){String[] id=android.provider.DocumentsContract.getDocumentId(uri).split(":",2);if(id.length==2&&id[1].matches("[0-9]+")){Uri collection="image".equals(id[0])?android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI:"video".equals(id[0])?android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI:android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;media=android.content.ContentUris.withAppendedId(collection,Long.parseLong(id[1]));}}
      try(Cursor cursor=context.getContentResolver().query(media,new String[]{"_data"},null,null,null)){if(cursor!=null&&cursor.moveToFirst()&&!cursor.isNull(0))file=new java.io.File(cursor.getString(0)).getCanonicalFile();}catch(Exception ignored){}
    }
    if(file!=null){String path=file.getCanonicalPath();for(java.io.File root:PhoneStorage.roots()){String base=root.getCanonicalPath();if(path.equals(base)||path.startsWith(base+"/"))return file.getCanonicalFile();}}
    return null;
  }
  private Uri storageUri(java.io.File file)throws Exception {
    String path=file.getCanonicalPath();for(java.io.File root:PhoneStorage.roots()){String base=root.getCanonicalPath();if(path.equals(base)||path.startsWith(base+"/")){String volume=root.equals(android.os.Environment.getExternalStorageDirectory())?"primary":root.getName();return android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents",volume+":"+(path.equals(base)?"":path.substring(base.length()+1)));}}throw new IOException("Location is outside shared phone storage.");
  }
  JSONObject reveal(Uri uri)throws Exception {
    java.io.File file=sharedFile(uri);
    Uri folder=null;
    if(file!=null&&file.exists()){
      java.io.File parent=file.isDirectory()?file:file.getParentFile();
      for(java.io.File root:PhoneStorage.roots()){String base=root.getCanonicalPath(),path=parent.getCanonicalPath();if(path.equals(base)||path.startsWith(base+"/")){String volume=root.equals(android.os.Environment.getExternalStorageDirectory())?"primary":root.getName();folder=android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents",volume+":"+(path.equals(base)?"":path.substring(base.length()+1)));break;}}
    }
    Intent view=folder!=null?new Intent(Intent.ACTION_VIEW).setDataAndType(folder,android.provider.DocumentsContract.Document.MIME_TYPE_DIR):new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,uri);
    view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_GRANT_READ_URI_PERMISSION);
    // Choose the system file browser rather than a wildcard document viewer or cloud uploader.
    for(String name:new String[]{"com.google.android.documentsui","com.android.documentsui"}){Intent candidate=new Intent(view).setPackage(name);if(candidate.resolveActivity(context.getPackageManager())!=null){context.startActivity(candidate);return new JSONObject().put("revealed",true).put("folder",folder==null?JSONObject.NULL:folder.toString());}}
    if(view.resolveActivity(context.getPackageManager())==null)throw new IOException("No Android file browser can reveal this location.");context.startActivity(view);return new JSONObject().put("revealed",true);
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
  private String appIcon(Uri uri)throws Exception {
    PhonePreview.Source source=source(uri);Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,PhonePreview.mimeFor(source.name(),source.mime()));android.content.pm.ResolveInfo app=context.getPackageManager().resolveActivity(intent,android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);if(app==null||app.activityInfo==null||app.activityInfo.packageName.equals("android")||app.activityInfo.packageName.equals(context.getPackageName()))return "";
    android.graphics.drawable.Drawable icon=app.loadIcon(context.getPackageManager());Bitmap bitmap=Bitmap.createBitmap(48,48,Bitmap.Config.ARGB_8888);icon.setBounds(0,0,48,48);icon.draw(new android.graphics.Canvas(bitmap));ByteArrayOutputStream bytes=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,bytes);bitmap.recycle();return "data:image/png;base64,"+Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP);
  }
  JSONObject thumbnailFile(java.io.File file)throws Exception{return thumbnail(storageUri(file));}
  private JSONObject thumbnail(Uri uri)throws Exception {
    String icon="";try{icon=appIcon(uri);}catch(Exception ignored){}JSONObject result;try{result=PhonePreview.thumbnail(source(uri));}catch(Exception ignored){result=new JSONObject().put("kind","none");}
    if(result.optString("kind").equals("image")){result.put("renderKind","thumbnail");if(!icon.isEmpty())result.put("iconDataUrl",icon);return result;}
    if(!icon.isEmpty()){byte[] bytes=Base64.decode(icon.substring(icon.indexOf(',')+1),Base64.DEFAULT);Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length);ByteArrayOutputStream jpeg=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.JPEG,75,jpeg);bitmap.recycle();return new JSONObject().put("kind","image").put("renderKind","icon").put("width",48).put("height",48).put("iconDataUrl",icon).put("dataUrl","data:image/jpeg;base64,"+Base64.encodeToString(jpeg.toByteArray(),Base64.NO_WRAP));}return result;
  }
}
