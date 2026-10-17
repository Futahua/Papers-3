package com.futahua.papers.mobile;
import java.io.*;import java.security.MessageDigest;import java.util.*;import java.util.regex.Pattern;
/** Destination-local collision candidates only, never a whole-storage hash scan. */
final class PhoneContentReuse {
 static String digest(File file)throws Exception {MessageDigest h=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] bytes=new byte[262144];int n;while((n=in.read(bytes))!=-1)h.update(bytes,0,n);}StringBuilder s=new StringBuilder();for(byte b:h.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 static File find(File folder,String name,long size,String expected)throws Exception {
  if(!expected.matches("[a-f0-9]{64}"))throw new IOException("Invalid source checksum");int dot=name.lastIndexOf('.');String stem=dot>0?name.substring(0,dot):name,ext=dot>0?name.substring(dot):"";Pattern family=Pattern.compile(Pattern.quote(stem)+"(?: \\([0-9]+\\))?"+Pattern.quote(ext));File[] list=folder.listFiles();if(list==null)throw new IOException("Destination cannot be read");int checked=0;
  for(File file:list){if(!family.matcher(file.getName()).matches()||!file.isFile()||file.length()!=size||java.nio.file.Files.isSymbolicLink(file.toPath()))continue;if(++checked>1000)break;android.system.StructStat before=android.system.Os.stat(file.getPath());String actual=digest(file);android.system.StructStat after=android.system.Os.stat(file.getPath());if(before.st_dev==after.st_dev&&before.st_ino==after.st_ino&&before.st_size==after.st_size&&before.st_mtime==after.st_mtime&&before.st_ctime==after.st_ctime&&actual.equals(expected))return file;}
  return null;
 }
}
