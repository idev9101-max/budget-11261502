#!/usr/bin/env python3
import json, os, socket, subprocess, time, base64, struct, threading, shutil
from pathlib import Path
CHROME = "/opt/.devin/chrome/chrome/linux-156.0.8078.47/chrome-linux64/chrome"
ROOT = Path("/home/ubuntu/experiment/budgetrepo")
APP = ROOT / "app"

def free_port():
    s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); return p
class WS:
    def __init__(self, url):
        from urllib.parse import urlparse
        u=urlparse(url)
        self.sock=socket.create_connection((u.hostname,u.port),5)
        key=base64.b64encode(os.urandom(16)).decode()
        req=(f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        resp=b''
        while b'\r\n\r\n' not in resp: resp+=self.sock.recv(4096)
        self.id=0; self.lock=threading.Lock()
    def _recv_exact(self,n):
        buf=b''
        while len(buf)<n:
            c=self.sock.recv(n-len(buf))
            if not c: raise RuntimeError('closed')
            buf+=c
        return buf
    def recv(self):
        h=self._recv_exact(2); op=h[0]&0x0f; masked=h[1]&0x80; ln=h[1]&0x7f
        if ln==126: ln=struct.unpack('!H',self._recv_exact(2))[0]
        elif ln==127: ln=struct.unpack('!Q',self._recv_exact(8))[0]
        if masked:
            mask=self._recv_exact(4); data=bytearray(self._recv_exact(ln))
            for i in range(len(data)): data[i]^=mask[i%4]
            data=bytes(data)
        else: data=self._recv_exact(ln)
        if op==8: raise RuntimeError('closed')
        if op==1: return data.decode('utf-8','replace')
        return self.recv()
    def send(self,obj):
        data=json.dumps(obj).encode(); n=len(data); hdr=bytearray([0x81]); mask_bit=0x80
        if n<126: hdr.append(mask_bit|n)
        elif n<65536: hdr.append(mask_bit|126); hdr+=struct.pack('!H',n)
        else: hdr.append(mask_bit|127); hdr+=struct.pack('!Q',n)
        mask=os.urandom(4); hdr+=mask; payload=bytearray(data)
        for i in range(len(payload)): payload[i]^=mask[i%4]
        with self.lock: self.sock.sendall(bytes(hdr)+bytes(payload))
    def call(self,method,params=None,timeout=20):
        self.id+=1; rid=self.id; self.send({'id':rid,'method':method,'params':params or {}})
        end=time.time()+timeout
        while time.time()<end:
            self.sock.settimeout(max(0.1,end-time.time()))
            msg=json.loads(self.recv())
            if msg.get('id')==rid:
                if 'error' in msg: raise RuntimeError(msg['error'])
                return msg.get('result',{})
        raise RuntimeError('timeout '+method)
    def close(self):
        try: self.sock.close()
        except: pass

def main():
    port=free_port()
    srv=subprocess.Popen(['python3','-m','http.server',str(port),'--bind','127.0.0.1'],cwd=str(APP),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    cdp=free_port(); profile=ROOT/'dev/.chrome-console'; shutil.rmtree(profile,ignore_errors=True); profile.mkdir(parents=True,exist_ok=True)
    chrome=subprocess.Popen([CHROME,'--headless=new','--no-sandbox','--disable-gpu',f'--remote-debugging-port={cdp}',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    errors=[]
    try:
        time.sleep(0.5)
        import urllib.request
        end=time.time()+10
        ws_url=None
        while time.time()<end:
            try:
                v=json.loads(urllib.request.urlopen(f'http://127.0.0.1:{cdp}/json/version',timeout=1).read())
                ws_url=v['webSocketDebuggerUrl']; break
            except: time.sleep(0.2)
        # get page target
        import urllib.request, json as _json
        targets=_json.loads(urllib.request.urlopen(f'http://127.0.0.1:{cdp}/json/list',timeout=2).read())
        page_ws = next((t['webSocketDebuggerUrl'] for t in targets if t.get('type')=='page'), ws_url)
        ws=WS(page_ws)
        ws.call('Runtime.enable'); ws.call('Log.enable'); ws.call('Page.enable')
        # capture console via events - need to read async; simple: poll after navigate
        for hashp in ['/#/','/#/transactions','/#/budget','/#/bills','/#/goals','/#/debt','/#/reports','/#/insights','/#/settings']:
            ws.call('Page.navigate',{'url':f'http://127.0.0.1:{port}/{hashp}'})
            time.sleep(1.2)
            # drain messages
            ws.sock.settimeout(0.1)
            for _ in range(50):
                try:
                    msg=json.loads(ws.recv())
                    if msg.get('method')=='Runtime.exceptionThrown':
                        d=msg['params'].get('exceptionDetails',{})
                        errors.append({'page':hashp,'text':d.get('text',''),'exception':d.get('exception',{}).get('description','')})
                    if msg.get('method')=='Log.entryAdded':
                        e=msg['params'].get('entry',{})
                        if e.get('level') in ('error','assert'):
                            errors.append({'page':hashp,'text':e.get('text',''),'source':e.get('source','')})
                except Exception: break
        ws.close()
    finally:
        chrome.terminate(); srv.terminate()
        try: chrome.wait(timeout=3)
        except: chrome.kill()
        try: srv.wait(timeout=3)
        except: srv.kill()
        shutil.rmtree(profile,ignore_errors=True)
    print(json.dumps(errors, indent=2))
    print(f"TOTAL_ERRORS={len(errors)}")

if __name__=='__main__':
    main()
