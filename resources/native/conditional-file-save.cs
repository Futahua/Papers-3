// Optional NTFS provider. Callers must authenticate the peer and supply owner-resolved paths.
// There is deliberately no non-transactional overwrite fallback.
using System;
using System.IO;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

public static class PapersConditionalFileSave {
  [DllImport("KtmW32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateTransaction(IntPtr attributes, IntPtr unit, uint options, uint isolation, uint flags, uint timeout, string description);
  [DllImport("KtmW32.dll", SetLastError=true)] static extern bool CommitTransaction(IntPtr transaction);
  [DllImport("KtmW32.dll", SetLastError=true)] static extern bool RollbackTransaction(IntPtr transaction);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileTransacted(string name, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template, IntPtr transaction, IntPtr miniVersion, IntPtr extended);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, System.Text.StringBuilder path, uint length, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
  [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low,High; }
  [StructLayout(LayoutKind.Sequential)] struct FileInformation { public uint Attributes; public FileTime Creation,Access,Write; public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
  public sealed class Result { public string OriginalSha256,SavedSha256,FileIdentity; public long Bytes; }
  static void Check(bool success){if(!success)throw new Win32Exception(Marshal.GetLastWin32Error());}
  static string Digest(Stream stream){stream.Position=0;using(var hash=SHA256.Create()){return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}}
  static string Normal(string path){return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);}
  static string FinalPath(SafeFileHandle handle){var text=new System.Text.StringBuilder(32768);uint size=GetFinalPathNameByHandle(handle,text,(uint)text.Capacity,0);Check(size>0&&size<text.Capacity);string result=text.ToString();if(result.StartsWith(@"\\?\UNC\",StringComparison.OrdinalIgnoreCase))result=@"\\"+result.Substring(8);else if(result.StartsWith(@"\\?\"))result=result.Substring(4);return Normal(result);}
  static bool Within(string root,string file){return file.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);}
  static List<SafeFileHandle> PinParents(string file){var handles=new List<SafeFileHandle>();try{string current=Path.GetPathRoot(file);string relative=Path.GetDirectoryName(file).Substring(current.Length);var paths=new List<string>();paths.Add(current);foreach(string name in relative.Split(new[]{Path.DirectorySeparatorChar},StringSplitOptions.RemoveEmptyEntries)){current=Path.Combine(current,name);paths.Add(current);}foreach(string directory in paths){var handle=CreateFile(directory,0x80,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(handle.IsInvalid){handle.Dispose();throw new Win32Exception(Marshal.GetLastWin32Error());}handles.Add(handle);FileInformation information;Check(GetFileInformationByHandle(handle,out information));if((information.Attributes&0x400)!=0||!String.Equals(FinalPath(handle),Normal(directory),StringComparison.OrdinalIgnoreCase))throw new IOException("A source directory changed or is a reparse point.");}return handles;}catch{foreach(var handle in handles)handle.Dispose();throw;}}
  public static Result Save(string original,string replacement,string approvedRoot,string expectedSourceSha256,string expectedReplacementSha256,Action prepared){
    original=Path.GetFullPath(original);replacement=Path.GetFullPath(replacement);approvedRoot=Normal(approvedRoot);
    if(!Within(approvedRoot,original)||String.Equals(original,replacement,StringComparison.OrdinalIgnoreCase))throw new IOException("Source is outside its approved folder or is the working copy itself.");
    if(!System.Text.RegularExpressions.Regex.IsMatch(expectedSourceSha256??"","^[a-f0-9]{64}$")||!System.Text.RegularExpressions.Regex.IsMatch(expectedReplacementSha256??"","^[a-f0-9]{64}$"))throw new IOException("A complete source and working-copy digest is required.");
    var parents=PinParents(original);IntPtr transaction=IntPtr.Zero;bool committed=false;
    try{using(var upload=new FileStream(replacement,FileMode.Open,FileAccess.Read,FileShare.Read)){
      if(Digest(upload)!=expectedReplacementSha256)throw new IOException("The working copy changed before saving.");
      transaction=CreateTransaction(IntPtr.Zero,IntPtr.Zero,0,0,0,0,"Papers checked file save");if(transaction==IntPtr.Zero||transaction==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
      var handle=CreateFileTransacted(original,0xC0000000,1,IntPtr.Zero,3,0x00200080,IntPtr.Zero,transaction,IntPtr.Zero,IntPtr.Zero);if(handle.IsInvalid){handle.Dispose();throw new Win32Exception(Marshal.GetLastWin32Error());}
      FileInformation information;using(var source=new FileStream(handle,FileAccess.ReadWrite)){
        Check(GetFileInformationByHandle(handle,out information));if((information.Attributes&(0x400|0x10))!=0||information.Links!=1||!String.Equals(FinalPath(handle),Normal(original),StringComparison.OrdinalIgnoreCase))throw new IOException("Source identity, link policy or location changed.");
        if(Digest(source)!=expectedSourceSha256)throw new IOException("The source changed; both versions are retained.");
        if(prepared!=null)prepared();
        upload.Position=0;source.Position=0;upload.CopyTo(source);source.SetLength(upload.Length);source.Flush(true);
        if(Digest(source)!=expectedReplacementSha256)throw new IOException("Saved bytes did not match the working copy.");
      }
      Check(CommitTransaction(transaction));committed=true;
      return new Result{OriginalSha256=expectedSourceSha256,SavedSha256=expectedReplacementSha256,Bytes=upload.Length,FileIdentity=information.Volume.ToString()+":"+(((ulong)information.IndexHigh<<32)|information.IndexLow).ToString()};
    }}finally{if(transaction!=IntPtr.Zero&&transaction!=new IntPtr(-1)){if(!committed)RollbackTransaction(transaction);CloseHandle(transaction);}foreach(var handle in parents)handle.Dispose();}
  }
}
