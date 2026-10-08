"""Read-only native placement probe; does not activate a window or move input."""
import ctypes
import json
import sys
from ctypes import wintypes as W
import uno
local=uno.getComponentContext()
resolver=local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver',local)
context=resolver.resolve('uno:pipe,name='+sys.argv[1]+';urp;StarOffice.ComponentContext')
desktop=context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop',context)
frames=desktop.getFrames()
frame=next(frames.getByIndex(i) for i in range(frames.getCount()) if frames.getByIndex(i).getController())
hwnd=frame.getContainerWindow().getWindowHandle((),1)
u=ctypes.WinDLL('user32')
def api(name,args,result):
 method=getattr(u,name);method.argtypes,method.restype=args,result;return method
parent=api('GetParent',[W.HWND],W.HWND)(hwnd)
first=api('GetWindow',[W.HWND,W.UINT],W.HWND)(parent,5)
rect=W.RECT();api('GetWindowRect',[W.HWND,ctypes.POINTER(W.RECT)],W.BOOL)(hwnd,ctypes.byref(rect))
point=W.POINT((rect.left+rect.right)//2,(rect.top+rect.bottom)//2)
api('ScreenToClient',[W.HWND,ctypes.POINTER(W.POINT)],W.BOOL)(parent,ctypes.byref(point))
hit=api('ChildWindowFromPointEx',[W.HWND,W.POINT,W.UINT],W.HWND)(parent,point,1)
view=frame.getComponentWindow().getPosSize()
client=W.RECT();api('GetClientRect',[W.HWND,ctypes.POINTER(W.RECT)],W.BOOL)(hwnd,ctypes.byref(client))
dc=api('GetDC',[W.HWND],W.HDC)(hwnd)
g=ctypes.WinDLL('gdi32');g.GetPixel.argtypes=[W.HDC,ctypes.c_int,ctypes.c_int];g.GetPixel.restype=W.DWORD
try:
 colors=[g.GetPixel(dc,x,y) for x in range(20,client.right,30) for y in range(20,client.bottom,30)]
finally:
 api('ReleaseDC',[W.HWND,W.HDC],ctypes.c_int)(hwnd,dc)
painted=[color for color in colors if color!=0xffffffff]
result={'editorAboveSiblingViews':first==hwnd,'editorReceivesPaneHit':hit==hwnd,'visible':bool(api('IsWindowVisible',[W.HWND],W.BOOL)(hwnd)),'contentViewSize':[view.Width,view.Height],'paintedColors':len(set(painted)),'readableSurface':bool(painted)}
if '--macro-proof' in sys.argv:
 model=frame.getController().getModel()
 result['macrosEnabled']=bool(model.AllowMacroExecution)
 library=model.BasicLibraries.createLibrary('PapersMacroProof')
 library.insertByName('Probe','Function Proof() As Integer\nProof = 42\nEnd Function')
 script=model.getScriptProvider().getScript('vnd.sun.star.script:PapersMacroProof.Probe.Proof?language=Basic&location=document')
 result['macroResult']=script.invoke((),(),())[0]
print(json.dumps(result))
