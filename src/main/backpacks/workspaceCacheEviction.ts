import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// FileShare.None refuses files held by an editor. Disposition is set on the
// same locked handles that were hashed, never on a subsequently resolved path.
const source=String.raw`using System;using System.IO;using System.Collections.Generic;using System.Security.Cryptography;using System.Runtime.InteropServices;using System.Web.Script.Serialization;using Microsoft.Win32.SafeHandles;
class CacheEvict {
 public class Spec {public string hash;public string[] files;}
 [StructLayout(LayoutKind.Sequential)]struct Attr {public uint attributes;public uint tag;}
 [StructLayout(LayoutKind.Sequential)]struct Disposition {[MarshalAs(UnmanagedType.Bool)]public bool delete;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeFileHandle CreateFile(string p,uint access,uint share,IntPtr security,uint mode,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int kind,out Attr data,uint size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetFileInformationByHandle(SafeFileHandle h,int kind,ref Disposition data,uint size);
 static void Main(string[] args){var json=new JavaScriptSerializer();var streams=new List<FileStream>();var marked=new List<SafeFileHandle>();long bytes=0;bool ok=false;string error=null;
 try{var spec=json.Deserialize<Spec>(File.ReadAllText(args[0]));foreach(string file in spec.files){var h=CreateFile(file,0x80010000,0,IntPtr.Zero,3,0x08200000,IntPtr.Zero);if(h.IsInvalid){h.Dispose();throw new IOException("A file is open or unavailable; retained locally.");}Attr attr;if(!GetFileInformationByHandleEx(h,9,out attr,8)||(attr.attributes&0x410)!=0){h.Dispose();throw new IOException("File identity changed.");}var stream=new FileStream(h,FileAccess.Read,1048576,false);streams.Add(stream);using(var sha=SHA256.Create()){string hash=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();if(hash!=spec.hash)throw new IOException("A local edit was retained.");}bytes+=stream.Length;}
 foreach(var stream in streams){var d=new Disposition{delete=true};if(!SetFileInformationByHandle(stream.SafeFileHandle,4,ref d,4))throw new IOException("Windows refused cache removal.");marked.Add(stream.SafeFileHandle);}ok=true;
 }catch(Exception e){error=e.Message;foreach(var h in marked){var d=new Disposition{delete=false};SetFileInformationByHandle(h,4,ref d,4);}}finally{foreach(var s in streams)s.Dispose();}
 Console.WriteLine(json.Serialize(new {ok=ok,bytes=ok?bytes:0,error=error}));}
}`;
const run=promisify(execFile);
export async function evictCheckedFiles(directory:string,files:string[],hash:string):Promise<{ok:boolean;bytes:number;error?:string}>{
  if(process.platform!=='win32')return {ok:false,bytes:0,error:'Checked cache eviction is unavailable.'};
  const tools=path.join(directory,'.cache-tools');await fs.mkdir(tools,{recursive:true});
  if((await fs.lstat(tools)).isSymbolicLink())throw Error('Cache helper folder was replaced.');
  const signature=createHash('sha256').update(source).digest('hex').slice(0,20),cs=path.join(tools,signature+'.cs'),exe=path.join(tools,signature+'.exe');
  try{await fs.access(exe);}catch{await fs.writeFile(cs,source);await run(path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe'),['/nologo','/r:System.Web.Extensions.dll','/out:'+exe,cs],{windowsHide:true,timeout:30000});}
  const manifest=path.join(tools,'evict-'+crypto.randomUUID()+'.json');
  try{await fs.writeFile(manifest,JSON.stringify({hash,files}));const result=await run(exe,[manifest],{windowsHide:true,timeout:120000,maxBuffer:65536});return JSON.parse(result.stdout);}
  finally{await fs.unlink(manifest).catch(()=>{});}
}
