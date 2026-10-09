using System;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public static class Program {
    public static string Mode,Checkpoint;
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [STAThread] public static void Main(string[] args) {
        try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
        if(args.Length==2&&args[0]=="--guard"){PaneCoordinator.Guard(args[1]);return;}
        Mode=args.Length>0?args[0]:"";Checkpoint=args.Length>1?args[1]:null;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if(args.Length>=1&&args[0]=="--fixture"){Application.Run(new FixtureForm(args.Length>1?args[1]:"Demo"));return;}
        Application.Run(new SplitHarness(args.Length>0&&args[0]=="--selftest"));
    }
}
public sealed class FixtureForm:Form {
    const int DialogMessage=0x8029;
    [StructLayout(LayoutKind.Sequential)] struct WindowPos {
        public IntPtr hwnd,after; public int x,y,cx,cy; public uint flags;
    }
    readonly string label;
    Rectangle beforeFullscreen;
    bool full;
    public FixtureForm(string name) {
        label=name;
        Text="Native split fixture: "+name;
        StartPosition=FormStartPosition.Manual;
        Location=new Point(100+(name.Length*17),80+(name.Length*25));
        Size=new Size(640,420);MinimumSize=new Size(270,230);
        if(name=="Fixed"){FormBorderStyle=FormBorderStyle.FixedSingle;MaximizeBox=false;Size=new Size(390,320);}
        if(name=="OriginalMax")WindowState=FormWindowState.Maximized;
        if(name=="OriginalMin")WindowState=FormWindowState.Minimized;
        if(name=="OriginalTop")TopMost=true;
        BackColor=name=="Blue"?Color.FromArgb(211,233,255):name=="Green"?Color.FromArgb(214,245,218):Color.FromArgb(250,235,213);
        var title=new Label{Text=name+" — real top-level Windows Form",Font=new Font("Segoe UI",18,FontStyle.Bold),
            Dock=DockStyle.Top,Height=85,TextAlign=ContentAlignment.MiddleCenter};
        var info=new Label{Text="Drag my LEFT border. Open my modal dialog. Use the Windows taskbar.\r\nThe coordinator does not parent or synthesize input.",
            Dock=DockStyle.Top,Height=75,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Segoe UI",10)};
        var dialog=new Button{Text="Open owned modal dialog",Dock=DockStyle.Top,Height=48};
        dialog.Click+=(s,e)=>OpenDialog();
        Controls.Add(info);Controls.Add(dialog);Controls.Add(title);
    }
    void OpenDialog(){
        using(var popup=new Form{Text=label+" owned dialog",StartPosition=FormStartPosition.Manual,
            Location=new Point(Bounds.Right-75,Bounds.Top+85),Size=new Size(340,220),
            FormBorderStyle=FormBorderStyle.FixedDialog,MinimizeBox=false,MaximizeBox=false}) {
            popup.Controls.Add(new Button{Text="Close modal",Dock=DockStyle.Bottom,Height=50,DialogResult=DialogResult.OK});
            popup.Controls.Add(new Label{Text="Owned dialog of "+label+"\r\nClick and type here to check focus.",Dock=DockStyle.Top,Height=70,TextAlign=ContentAlignment.MiddleCenter});
            popup.Controls.Add(new TextBox{Dock=DockStyle.Top,Text="Focus check"});
            popup.AcceptButton=popup.Controls[0] as Button;
            popup.ShowDialog(this);
        }
    }
    protected override void WndProc(ref Message m){
        // Deliberately nonconforming test app: advertises normal Win32 minimum
        // but silently rejects a requested 700+ pixel width during placement.
        if(label=="Resistant"&&m.Msg==0x46){
            var pos=(WindowPos)Marshal.PtrToStructure(m.LParam,typeof(WindowPos));
            if((pos.flags&0x1)==0&&pos.cx>680){pos.cx=650;Marshal.StructureToPtr(pos,m.LParam,false);}
        }
        if(m.Msg==0x802A){
            bool enter=m.WParam!=IntPtr.Zero;
            if(enter&&!full){beforeFullscreen=Bounds;full=true;FormBorderStyle=FormBorderStyle.None;Bounds=Screen.FromHandle(Handle).Bounds;}
            else if(!enter&&full){full=false;FormBorderStyle=FormBorderStyle.Sizable;Bounds=beforeFullscreen;}
            return;
        }
        if(m.Msg==DialogMessage){BeginInvoke((Action)OpenDialog);return;}
        base.WndProc(ref m);
    }
}
