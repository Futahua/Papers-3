package com.futahua.papers.mobile;
import android.content.Context;import android.net.Uri;import android.graphics.Bitmap;import android.graphics.BitmapFactory;import android.util.Base64;import java.io.*;
/** Clipboard access is explicit and foreground-only; no background clipboard listener. */
final class PhoneClipboard {
 static String image(Context context,Uri uri)throws Exception{
  String mime=context.getContentResolver().getType(uri);if(mime==null||!mime.startsWith("image/"))throw new IOException("Copy an image to the clipboard first.");
  byte[] bytes;try(InputStream input=context.getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){
   if(input==null)throw new IOException("Clipboard image is unavailable.");byte[] buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1){if(out.size()+count>8*1024*1024)throw new IOException("Clipboard image is too large.");out.write(buffer,0,count);}bytes=out.toByteArray();
  }
  BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
  if(options.outWidth<=0||options.outHeight<=0)throw new IOException("Clipboard image cannot be decoded.");
  options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>512)options.inSampleSize*=2;options.inJustDecodeBounds=false;
  Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(bitmap==null)throw new IOException("Clipboard image cannot be decoded.");
  try(ByteArrayOutputStream output=new ByteArrayOutputStream()){bitmap.compress(Bitmap.CompressFormat.PNG,100,output);return "data:image/png;base64,"+Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP);}finally{bitmap.recycle();}
 }
}
