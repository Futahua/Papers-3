using System;using System.Drawing;using System.IO;using System.Reflection;using System.Runtime.InteropServices;using System.Threading;using System.Windows.Forms;
public class ForegroundRegression {
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 static void Check(bool yes,string text){if(!yes)throw new Exception(text);}
 static void Pump(){for(int n=0;n<5;n++){Application.DoEvents();Thread.Sleep(15);}}
 static bool Above(IntPtr a,IntPtr b){for(var h=a;h!=IntPtr.Zero;h=Native.GetWindow(h,2))if(h==b)return true;return false;}
 [STAThread]public static void Main(string[] args){if(args.Length==2&&args[0]=="--guard"){PaneCoordinator.Guard(args[1]);return;}var original=Native.GetForegroundWindow();
 try{foreach(bool shared in new[]{false,true}){
 var dir=Path.Combine(Path.GetTempPath(),"papers-foreground-"+Guid.NewGuid());Directory.CreateDirectory(dir);
 using(var host=new Form())using(var peer=new Form())using(var cover=new Form()){
 foreach(var f in new[]{host,peer,cover}){f.ShowInTaskbar=false;f.StartPosition=FormStartPosition.Manual;f.MaximumSize=new Size(1600,1000);f.Bounds=new Rectangle(-20000,-20000,1000,700);f.Show();}
 PaneCoordinatorHub hub=shared?new PaneCoordinatorHub(host.Handle):null;
 var pane=new PaneCoordinator(host.Handle,Path.Combine(dir,"recovery"),Path.Combine(dir,"log"),s=>{},32,hub,"test",true);
 try{pane.SetViewport(new Rectangle(-20000,-20000,1000,700),1);uint pid;Native.GetWindowThreadProcessId(peer.Handle,out pid);pane.Attach(peer.Handle,pid,"main",pane.Scope.BindingGeneration,pane.Scope.StateRevision);Pump();
 if(args.Length==1&&args[0]=="relative"){
 Native.SetWindowPos(peer.Handle,IntPtr.Zero,0,0,0,0,0x213);Native.SetWindowPos(cover.Handle,IntPtr.Zero,0,0,0,0,0x213);Native.SetWindowPos(host.Handle,IntPtr.Zero,0,0,0,0,0x213);
 var before=Native.GetForegroundWindow();Check(Above(cover.Handle,peer.Handle),"cover starts above peer");pane.Raise();
 Check(Above(host.Handle,peer.Handle)&&Above(peer.Handle,cover.Handle),"peer joins host band above cover");Check(Native.GetForegroundWindow()==before,"relative stack retains foreground");
 Console.WriteLine((shared?"hub":"standalone")+" relative stacking verified");continue;
 }
 SetForegroundWindow(host.Handle);Pump();Check(Native.GetForegroundWindow()==host.Handle,"fixture host becomes foreground");
 Native.SetWindowPos(peer.Handle,IntPtr.Zero,0,0,0,0,0x213);Native.SetWindowPos(cover.Handle,IntPtr.Zero,0,0,0,0,0x213);Native.SetWindowPos(host.Handle,IntPtr.Zero,0,0,0,0,0x213);
 Check(Above(cover.Handle,peer.Handle),"intervening application covers native peer");
 if(shared)typeof(PaneCoordinatorHub).GetMethod("Route",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(hub,new object[]{IntPtr.Zero,(uint)3,host.Handle,0,0,(uint)0,(uint)0});else pane.SafeNativeEvent(IntPtr.Zero,3,host.Handle,0,0,0,0);
 Check(Above(peer.Handle,cover.Handle),"host foreground raises native pane above covering app");Check(Native.GetForegroundWindow()==host.Handle,"restack keeps host focus");
 // A delayed host event must not raise Papers over the user's next application.
 SetForegroundWindow(cover.Handle);Pump();Check(Native.GetForegroundWindow()==cover.Handle,"cover becomes foreground");
 if(shared)typeof(PaneCoordinatorHub).GetMethod("Route",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(hub,new object[]{IntPtr.Zero,(uint)3,host.Handle,0,0,(uint)0,(uint)0});else pane.SafeNativeEvent(IntPtr.Zero,3,host.Handle,0,0,0,0);
 Check(Above(cover.Handle,peer.Handle),"stale focus event does not steal stacking");
 Console.WriteLine((shared?"hub":"standalone")+" foreground stacking verified");
 }finally{peer.Close();Pump();pane.Release();if(hub!=null)hub.Dispose();}}
 }}finally{SetForegroundWindow(original);}
 }
}
