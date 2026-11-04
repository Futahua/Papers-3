using System;using System.Drawing;using System.Reflection;using System.Runtime.InteropServices;using System.Windows.Forms;
class ConstrainedWindow:Form {
 public bool Constrain;
 [StructLayout(LayoutKind.Sequential)]struct Pos{public IntPtr h,a;public int x,y,cx,cy;public uint flags;}
 protected override void WndProc(ref Message m){if(Constrain&&m.Msg==0x46){var p=(Pos)Marshal.PtrToStructure(m.LParam,typeof(Pos));if((p.flags&1)==0){p.cx=420;p.cy=644;Marshal.StructureToPtr(p,m.LParam,false);}}base.WndProc(ref m);}
}
class RecoveryRegression {
 [STAThread]static void Main(string[] args){if(args.Length==2&&args[0]=="--guard"){PaneCoordinator.Guard(args[1]);return;}
 using(var f=new ConstrainedWindow()){f.ShowInTaskbar=false;f.StartPosition=FormStartPosition.Manual;f.Bounds=new Rectangle(-20000,-20000,1000,720);f.Show();uint pid;Native.GetWindowThreadProcessId(f.Handle,out pid);var s=new WindowSession(f.Handle.ToInt64(),pid).Saved;f.Constrain=true;
 var method=typeof(PaneCoordinator).GetMethod("RestoreSavedWindow",BindingFlags.NonPublic|BindingFlags.Static);
 bool strict=false;try{method.Invoke(null,new object[]{s,false});}catch(TargetInvocationException){strict=true;}
 if(!strict)throw new Exception("Fixture did not reproduce constrained placement");
 method.Invoke(null,new object[]{s,true});
 if(!f.Visible)throw new Exception("Recovery lost visibility");
 if(s.Placement.Normal.R-s.Placement.Normal.L!=1000)throw new Exception("Original saved placement changed");
 Console.WriteLine("Constrained crash recovery accepted; strict release and original saved bounds preserved");
 }}
}
