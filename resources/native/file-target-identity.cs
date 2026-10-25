using System;using System.IO;using System.Text;using System.Runtime.InteropServices;using System.Web.Script.Serialization;using System.Collections.Generic;using Microsoft.Win32.SafeHandles;
public static class FileTargetIdentity {
 [StructLayout(LayoutKind.Sequential)]struct Descriptor{public uint Size,Type;[MarshalAs(UnmanagedType.ByValArray,SizeConst=16)]public byte[] Id;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeFileHandle CreateFile(string p,uint a,uint s,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int kind,byte[] data,uint size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern SafeFileHandle OpenFileById(SafeFileHandle hint,ref Descriptor id,uint access,uint share,IntPtr security,uint flags);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool DeviceIoControl(SafeFileHandle h,uint code,IntPtr input,uint inputSize,byte[] output,uint outputSize,out uint returned,IntPtr overlapped);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder b,uint size,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool GetVolumePathName(string p,StringBuilder b,uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool GetVolumeNameForVolumeMountPoint(string p,StringBuilder b,uint size);
 static SafeFileHandle Open(string p){return CreateFile(p,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero);}
 static string Text(Dictionary<string,object> r,string k){object v;return r.TryGetValue(k,out v)?Convert.ToString(v):"";}
 static object Describe(SafeFileHandle h,bool enroll=false){var data=new byte[24];if(!GetFileInformationByHandleEx(h,18,data,24))return new{status="unsupported",error=Marshal.GetLastWin32Error()};
 var b=new StringBuilder(32768);if(GetFinalPathNameByHandle(h,b,32768,0)==0)return new{status="unavailable"};var p=b.ToString();if(p.StartsWith(@"\\?\UNC\"))p=@"\\"+p.Substring(8);else if(p.StartsWith(@"\\?\"))p=p.Substring(4);
 var mount=new StringBuilder(32768);var volume=new StringBuilder(32768);if(!GetVolumePathName(p,mount,32768)||!GetVolumeNameForVolumeMountPoint(mount.ToString(),volume,32768))return new{status="unsupported"};
 var id=new byte[16];Array.Copy(data,8,id,0,16);var objectBuffer=new byte[64];uint returned;bool hasObject=DeviceIoControl(h,0x9009c,IntPtr.Zero,0,objectBuffer,64,out returned,IntPtr.Zero);if(!hasObject&&enroll)hasObject=DeviceIoControl(h,0x900c0,IntPtr.Zero,0,objectBuffer,64,out returned,IntPtr.Zero);
 var basic=new byte[40];var standard=new byte[24];string version=null;if(GetFileInformationByHandleEx(h,0,basic,40)&&GetFileInformationByHandleEx(h,1,standard,24))version=BitConverter.ToInt64(basic,16).ToString()+":"+BitConverter.ToInt64(standard,8).ToString();
 return new{status="present",path=p,volume=volume.ToString(),fileId=BitConverter.ToString(id).Replace("-","").ToLowerInvariant(),serial=BitConverter.ToUInt64(data,0).ToString(),version,objectId=hasObject?BitConverter.ToString(objectBuffer,0,16).Replace("-","").ToLowerInvariant():null};}
 static object Run(Dictionary<string,object> r){try{
 if(Text(r,"fileId")==""){using(var h=Open(Text(r,"path"))){if(h.IsInvalid)return new{status="unavailable",error=Marshal.GetLastWin32Error()};return Describe(h,Text(r,"status")=="enroll");}}
 bool byObject=Text(r,"objectId")!="";string raw=Text(r,byObject?"objectId":"fileId");if(raw.Length!=32)throw new Exception("Invalid identity");var bytes=new byte[16];for(int n=0;n<16;n++)bytes[n]=Convert.ToByte(raw.Substring(n*2,2),16);
 // A directory on the same volume is sufficient; do not request a privileged raw volume handle.
 using(var hint=Open(Text(r,"volume"))){if(hint.IsInvalid)return new{status="unavailable",error=Marshal.GetLastWin32Error()};var d=new Descriptor{Size=24,Type=byObject?1U:2U,Id=bytes};using(var h=OpenFileById(hint,ref d,0,7,IntPtr.Zero,0x02000000)){if(h.IsInvalid){int error=Marshal.GetLastWin32Error();return new{status=(error==2||error==3)?"missing":"unavailable",error};}return Describe(h);}}
 }catch{return new{status="unavailable"};}}
 public static void Main(string[] args){var json=new JavaScriptSerializer{MaxJsonLength=4*1024*1024};
 // Paths cross this pipe as UTF-8. The console code page (default for Console.In/Out) cannot carry
 // Vietnamese and other non-ANSI names, so such files could never be identified or followed.
 var utf8=new UTF8Encoding(false);var input=new StreamReader(Console.OpenStandardInput(),utf8);var output=new StreamWriter(Console.OpenStandardOutput(),utf8){AutoFlush=true};
 if(args.Length==1&&args[0]=="serve"){string request;while((request=input.ReadLine())!=null){try{var items=json.DeserializeObject(request) as object[];var result=new List<object>();foreach(var item in items)result.Add(Run((Dictionary<string,object>)item));output.WriteLine(json.Serialize(result));}catch{output.WriteLine("null");}}return;}
 if(args.Length==1&&args[0]=="watch"){var watches=new Dictionary<string,FileSystemWatcher>(StringComparer.OrdinalIgnoreCase);string line;while((line=input.ReadLine())!=null){try{var dirs=json.Deserialize<string[]>(line);var keep=new HashSet<string>(dirs,StringComparer.OrdinalIgnoreCase);foreach(var p in new List<string>(watches.Keys))if(!keep.Contains(p)){watches[p].Dispose();watches.Remove(p);}foreach(var p in dirs)if(!watches.ContainsKey(p)&&Directory.Exists(p)){var watch=new FileSystemWatcher(p);watch.NotifyFilter=NotifyFilters.FileName|NotifyFilters.DirectoryName;watch.Deleted+=(s,e)=>{lock(watches)output.WriteLine(json.Serialize(new{deleted=e.FullPath}));};watch.EnableRaisingEvents=true;watches.Add(p,watch);}}catch{}}foreach(var w in watches.Values)w.Dispose();return;}
 try{var items=json.DeserializeObject(input.ReadToEnd()) as object[];var result=new List<object>();foreach(var item in items)result.Add(Run((Dictionary<string,object>)item));output.Write(json.Serialize(result));}catch{Environment.ExitCode=1;}}
}
