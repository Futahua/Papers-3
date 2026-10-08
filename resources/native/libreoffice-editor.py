"""Host installed LibreOffice's official system-child editor in a Papers-owned HWND.

Uses LibreOffice's bundled Python/UNO. The original file stays the document URL.
Closing an unsaved editor creates an ordinary LibreOffice window for the SAME model;
no implicit save, discard, or forced termination of modified documents occurs.
"""
import ctypes
import os
import json
import queue
import shutil
import subprocess
import sys
import threading
import time
from ctypes import wintypes as W
from pathlib import Path
import uno
import unohelper
from com.sun.star.task import XStatusIndicator


EMIT_LOCK = threading.Lock()

def emit(value):
    with EMIT_LOCK:
        print(json.dumps(value, ensure_ascii=True), flush=True)


def property_value(name, value):
    item = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    item.Name, item.Value = name, value
    return item


class LoadProgress(unohelper.Base, XStatusIndicator):
    def __init__(self):
        self.text, self.maximum, self.value = 'Opening document…', None, None

    def publish(self, phase='loading-document'):
        emit({'kind': 'progress', 'phase': phase, 'text': self.text,
              'value': self.value, 'maximum': self.maximum})

    def start(self, text, maximum):
        self.text, self.maximum = text or 'Opening document…', maximum if maximum > 0 else None
        self.value = 0 if self.maximum else None
        self.publish()

    def setText(self, text):
        self.text = text or 'Opening document…'
        self.publish()

    def setValue(self, value):
        self.value = value
        self.publish()

    def reset(self):
        self.value = 0 if self.maximum else None
        self.publish()

    def end(self):
        self.maximum = self.value = None
        self.text = 'Preparing editor…'
        self.publish(phase='preparing-editor')


def run(args):
    program, profile, pipe = Path(args[0]), Path(args[1]), args[2]
    parent, hwnd = 0, 0
    native = ctypes.WinDLL('user32', use_last_error=True)

    def api(name, arguments, result):
        method = getattr(native, name)
        method.argtypes, method.restype = arguments, result
        return method

    is_window = api('IsWindow', [W.HWND], W.BOOL)
    get_dpi = api('GetDpiForWindow', [W.HWND], W.UINT)
    position = api('SetWindowPos', [W.HWND, W.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.UINT], W.BOOL)
    show = api('ShowWindow', [W.HWND, ctypes.c_int], W.BOOL)
    get_parent = api('GetParent', [W.HWND], W.HWND)
    get_style = api('GetWindowLongPtrW', [W.HWND, ctypes.c_int], ctypes.c_ssize_t)
    set_style = api('SetWindowLongPtrW', [W.HWND, ctypes.c_int, ctypes.c_ssize_t], ctypes.c_ssize_t)
    set_alpha = api('SetLayeredWindowAttributes', [W.HWND, W.DWORD, ctypes.c_ubyte, W.DWORD], W.BOOL)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [W.LPVOID, W.LPCWSTR]
    kernel.CreateJobObjectW.restype = W.HANDLE
    kernel.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
    kernel.AssignProcessToJobObject.restype = W.BOOL
    kernel.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]
    kernel.TerminateJobObject.restype = W.BOOL
    kernel.CloseHandle.argtypes = [W.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    # No KILL_ON_JOB_CLOSE: an unsaved model transferred to a normal window
    # must outlive the helper. Termination is explicit and only for clean engines.
    commands, stopping, engine_ready = queue.Queue(), threading.Event(), threading.Event()

    def read_commands():
        try:
            for line in sys.stdin:
                if len(line) > 16384:
                    continue
                try:
                    command = json.loads(line)
                    if isinstance(command, dict):
                        if command.get('operation') == 'close' and not engine_ready.is_set():
                            stopping.set()
                            if command.get('id'):
                                emit({'kind': 'reply', 'id': command['id'], 'ok': True, 'detached': False, 'reusable': False})
                        else:
                            commands.put(command)
                except ValueError:
                    pass
        finally:
            stopping.set()

    threading.Thread(target=read_commands, daemon=True).start()
    process = desktop = document = frame = None
    leave_running = False
    engine_exited = False
    visible, rectangle = True, [0, 0, 1, 1]

    def usage_samples():
        # Query this engine's Windows job, not unrelated LibreOffice processes.
        kernel.QueryInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, W.LPVOID, W.DWORD, ctypes.POINTER(W.DWORD)]
        kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        kernel.OpenProcess.restype = W.HANDLE
        psapi = ctypes.WinDLL('psapi')
        class Memory(ctypes.Structure):
            _fields_ = [('cb', W.DWORD), ('faults', W.DWORD)] + [(name, ctypes.c_size_t) for name in ['peakWorking', 'working', 'peakPaged', 'paged', 'peakNonpaged', 'nonpaged', 'pagefile', 'peakPagefile', 'private']]
        psapi.GetProcessMemoryInfo.argtypes = [W.HANDLE, ctypes.POINTER(Memory), W.DWORD]
        previous_time, previous_cpu = time.monotonic(), 0
        while not stopping.wait(1):
            try:
                data = ctypes.create_string_buffer(65536)
                if not kernel.QueryInformationJobObject(job, 3, data, len(data), None):
                    continue
                count = min(ctypes.c_uint32.from_buffer(data, 4).value, (len(data) - 8) // ctypes.sizeof(ctypes.c_size_t))
                ids = [ctypes.c_size_t.from_buffer(data, 8 + i * ctypes.sizeof(ctypes.c_size_t)).value for i in range(count)]
                memory, cpu = 0, 0
                for pid in ids:
                    handle = kernel.OpenProcess(0x410, False, pid)
                    if not handle:
                        continue
                    try:
                        metrics = Memory(); metrics.cb = ctypes.sizeof(metrics)
                        if psapi.GetProcessMemoryInfo(handle, ctypes.byref(metrics), metrics.cb):
                            memory += metrics.working
                    finally:
                        kernel.CloseHandle(handle)
                accounting = ctypes.create_string_buffer(48)
                if kernel.QueryInformationJobObject(job, 1, accounting, len(accounting), None):
                    cpu = (ctypes.c_int64.from_buffer(accounting, 0).value + ctypes.c_int64.from_buffer(accounting, 8).value) / 10000000
                now = time.monotonic()
                percent = max(0, cpu - previous_cpu) / max(.001, now - previous_time) * 100
                emit({'kind': 'usage', 'sampledAt': time.time(), 'processIds': ids, 'workingSetBytes': memory, 'cpuPercent': percent})
                previous_time, previous_cpu = now, cpu
            except Exception:
                continue

    threading.Thread(target=usage_samples, daemon=True).start()
    try:
        profile.mkdir(parents=True, exist_ok=True)
        arguments = [str(program / 'soffice.bin'), '-env:UserInstallation=' + profile.as_uri(),
                     '--invisible', '--nologo', '--norestore', '--nodefault',
                     '--accept=pipe,name=' + pipe + ';urp;StarOffice.ComponentContext']
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0

        def launch():
            engine_environment = dict(os.environ)
            engine_environment['UserInstallation'] = profile.as_uri()
            # Embedded child surfaces do not need a separate GPU/OpenCL context.
            engine_environment['SAL_SKIA'] = 'raster'
            engine_environment['SAL_DISABLE_OPENCL'] = '1'
            child = subprocess.Popen(arguments, cwd=program, startupinfo=startup, env=engine_environment,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=sys.stderr)
            if not kernel.AssignProcessToJobObject(job, int(child._handle)):
                child.kill()
                raise ctypes.WinError(ctypes.get_last_error())
            emit({'kind': 'engine', 'pid': child.pid})
            return child

        process = launch()
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        deadline, restarts, context = time.monotonic() + 60, 0, None
        while time.monotonic() < deadline and not stopping.is_set() :
            exit_code = process.poll()
            if exit_code == 81 and restarts < 2:
                # A new LibreOffice profile requests normal initialization restart.
                restarts += 1
                process = launch()
            elif exit_code is not None and exit_code != 0:
                raise RuntimeError('LibreOffice exited during startup (' + str(exit_code) + ').')
            try:
                context = resolver.resolve('uno:pipe,name=' + pipe + ';urp;StarOffice.ComponentContext')
                break
            except Exception:
                time.sleep(.1)
        if not context:
            raise RuntimeError('LibreOffice did not become ready. Try opening the document again.')
        if stopping.is_set():
            return
        services = context.ServiceManager
        emit({'kind': 'phase', 'phase': 'connected'})
        desktop = services.createInstanceWithContext('com.sun.star.frame.Desktop', context)
        paths = services.createInstanceWithContext('com.sun.star.util.PathSettings', context)
        actual_profile = str(paths.UserConfig)
        if not actual_profile.lower().startswith(profile.as_uri().lower() + '/'):
            # Do not touch a document or shut down a different office instance.
            desktop = None
            leave_running = True
            raise RuntimeError('LibreOffice started with a different profile. Inline editing was stopped to protect other open documents.')
        toolkit = services.createInstanceWithContext('com.sun.star.awt.Toolkit', context)
        def place():
            scale = (get_dpi(parent) or 96) / 96.0
            x, y, width, height = [round(value * scale) for value in rectangle]
            # HWND_TOP keeps the native child above Chromium's sibling views.
            # NOZORDER would leave an otherwise ready editor hidden behind them.
            if not position(hwnd, None, x, y, max(1, width), max(1, height), 0x0010 | 0x0020):
                raise ctypes.WinError(ctypes.get_last_error())
            window.setVisible(visible)
            show(hwnd, 4 if visible else 0)

        def open_document(command):
            nonlocal parent, hwnd, rectangle, visible, frame, document, window
            if document:
                raise RuntimeError('Close the current document before opening another.')
            parent = int(command['parent'])
            target = Path(command['path'])
            rectangle = command['rect']
            visible = False
            if not is_window(parent) or len(rectangle) != 4:
                raise RuntimeError('Invalid inline editor owner or geometry.')
            if target.suffix.lower() not in {'.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ods'} or not target.is_file():
                raise RuntimeError('Choose a supported office document.')
            emit({'kind': 'phase', 'phase': 'creating-child'})
            window = uno.invoke(toolkit, 'createSystemChild', (uno.Any('hyper', parent), (), 1))
            if not window:
                raise RuntimeError('LibreOffice could not create an inline editor window.')
            frame = services.createInstanceWithContext('com.sun.star.frame.Frame', context)
            frame.initialize(window)
            frame.setName('PapersInlineEditor')
            desktop.getFrames().append(frame)
            hwnd = window.getWindowHandle((), 1)
            if not hwnd or get_parent(hwnd) != parent:
                raise RuntimeError('LibreOffice did not attach its editor to the Papers window.')

            # Chromium's NOREDIRECTIONBITMAP parent does not provide a GDI backing
            # surface for this VCL child. An opaque layered child owns its own surface;
            # sibling clipping also matches the existing native preview host.
            set_style(hwnd, -16, get_style(hwnd, -16) | 0x06000000)
            set_style(hwnd, -20, get_style(hwnd, -20) | 0x00080000)
            if not set_alpha(hwnd, 0, 255, 2):
                raise ctypes.WinError(ctypes.get_last_error())

            place()
            emit({'kind': 'phase', 'phase': 'loading-document'})
            document = desktop.loadComponentFromURL(target.as_uri(), 'PapersInlineEditor', 23, (
                property_value('Hidden', False),
                property_value('StatusIndicator', LoadProgress()),
                property_value('MacroExecutionMode', uno.getConstantByName('com.sun.star.document.MacroExecMode.ALWAYS_EXECUTE_NO_WARN')),
                property_value('UpdateDocMode', uno.getConstantByName('com.sun.star.document.UpdateDocMode.NO_UPDATE')),
            ))
            if not document:
                raise RuntimeError('LibreOffice could not open this document.')

            visible = True
            place()
            return {'ok': True, 'hwnd': str(hwnd), 'readOnly': bool(document.isReadonly())}

        def finish():
            nonlocal leave_running, document, frame, hwnd
            if document and document.isModified():
                # NewWindow attaches another controller to the existing model.
                # Close only the inline frame, preserving unsaved edits and native Save UI.
                dispatcher = services.createInstanceWithContext('com.sun.star.frame.DispatchHelper', context)
                dispatcher.executeDispatch(frame, '.uno:NewWindow', '', 0, ())
                siblings = desktop.getFrames()
                kept = any(siblings.getByIndex(index) != frame and
                           siblings.getByIndex(index).getController() and
                           siblings.getByIndex(index).getController().getModel() == document
                           for index in range(siblings.getCount()))
                if not kept:
                    raise RuntimeError('Could not keep the unsaved document open. Save it before leaving the editor.')
                leave_running = True
                frame.close(True)
                document = frame = None
                hwnd = 0
                return {'ok': True, 'detached': True, 'reusable': False}
            if document:
                document.close(True)
                document = frame = None
            hwnd = 0
            return {'ok': True, 'detached': False, 'reusable': True}

        window = None
        engine_ready.set()
        emit({'kind': 'engine-ready'})
        while not stopping.is_set():
            if document and (not is_window(parent) or not is_window(hwnd)):
                finish()
                if leave_running:
                    break
            try:
                command = commands.get(timeout=.25)
            except queue.Empty:
                continue
            request_id, operation = command.get('id'), command.get('operation')
            try:
                result = {'ok': True}
                if operation == 'open':
                    result = open_document(command)
                elif operation == 'move':
                    if not document:
                        continue
                    candidate = command.get('rect')
                    if not isinstance(candidate, list) or len(candidate) != 4 or not all(isinstance(value, (float, int)) for value in candidate):
                        raise ValueError('Invalid editor rectangle.')
                    rectangle = candidate
                    place()
                elif operation == 'visible':
                    if not document:
                        continue
                    visible = command.get('visible') is True
                    place()
                elif operation == 'focus':
                    frame.activate()
                    frame.getComponentWindow().setFocus()
                elif operation == 'save':
                    document.store()
                elif operation == 'close':
                    result = finish()
                else:
                    raise ValueError('Unknown editor operation.')
                if request_id:
                    emit({'kind': 'reply', 'id': request_id, **result})
                if operation == 'close' and leave_running:
                    break
            except Exception as error:
                if request_id:
                    emit({'kind': 'reply', 'id': request_id, 'ok': False, 'message': str(error)[:1000]})
        if document:
            finish()
    except Exception as error:
        emit({'kind': 'error', 'message': str(error)[:1000]})
        # Never force-close a model known to have unsaved changes.
        if document:
            try:
                if document.isModified():
                    leave_running = True
            except Exception:
                leave_running = True
    finally:
        if not leave_running:
            if document:
                try:
                    document.close(True)
                except Exception:
                    pass
            if desktop:
                try:
                    desktop.terminate()
                except Exception:
                    pass
            if process:
                try:
                    process.wait(timeout=5)
                    engine_exited = True
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                    engine_exited = True
            # The Windows job owns restarted/launcher-descendant processes too.
            # A launcher exiting 0 does not imply its restarted office engine exited.
            kernel.TerminateJobObject(job, 0)
            if engine_exited and profile.parent.name == 'office-editors':
                shutil.rmtree(profile, ignore_errors=True)
        kernel.CloseHandle(job)


if __name__ == '__main__':
    run(sys.argv[1:])
