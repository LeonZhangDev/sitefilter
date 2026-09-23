#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SiteFilter「自定义下载器」本机桥（native-host/host.py）专项测试。

这个 host 是**安全边界**：它能被扩展唤起去启动本机程序。所以最该被测的不是
"能启动"，而是"什么情况下坚决不启动" —— 非法 magnet、非绝对路径、不存在的文件、
被白名单拒绝的扩展名。这里把这些负面路径逐条钉死。

另外在进程层测一次 Native Messaging 的帧协议（4 字节小端长度 + JSON），
确保 host 与 Chrome 之间的通道本身是通的。

安全：所有会走到"启动"的用例都把 subprocess.Popen 替换成假实现，**不会真的启动
任何程序**；进程层用例只发 ping。
"""
import importlib.util
import json
import os
import struct
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True          # 不往 native-host/ 里留 __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
HOST_PY = os.path.join(HERE, 'native-host', 'host.py')

_pass = True


def check(name, cond):
    global _pass
    print(('PASS  ' if cond else 'FAIL  ') + name)
    if not cond:
        _pass = False


# ---------------------------------------------------------------- 载入 host 模块

spec = importlib.util.spec_from_file_location('sf_host', HOST_PY)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

# 拦截"发送响应"与"真正启动进程"
replies = []
host.write_message = lambda obj: replies.append(obj)

captured = {}


class FakePopen(object):
    def __init__(self, args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.pid = 4242


def fake_popen(args, **kwargs):
    captured['args'] = args
    captured['kwargs'] = kwargs
    return FakePopen(args, **kwargs)


# 注意：不能写 host.subprocess.Popen = fake_popen —— subprocess 是共享模块对象，
# 那样会污染全局，把后面的进程层用例也换成假实现。
# 正确做法是把 host 模块里的 subprocess 换成一个只带 Popen 的替身。
class _StubSubprocess(object):
    Popen = staticmethod(fake_popen)


host.subprocess = _StubSubprocess


def call(payload):
    del replies[:]
    captured.clear()
    host.handle_open_magnet('test-id', payload)
    return replies[-1] if replies else None


# ---------------------------------------------------------------- 准备夹具

tmpdir = tempfile.mkdtemp(prefix='sf-host-test-')
FAKE_EXE = os.path.join(tmpdir, 'Thunder.exe')
with open(FAKE_EXE, 'w', encoding='utf-8') as f:
    f.write('not a real exe; never executed')
FAKE_TXT = os.path.join(tmpdir, 'notes.txt')
with open(FAKE_TXT, 'w', encoding='utf-8') as f:
    f.write('x')

GOOD_MAGNET = 'magnet:?xt=urn:btih:c12fe1aabbccddeeff00112233445566778899aa&dn=ABC-001.mkv'

# ---------------------------------------------------------------- 正面：合法输入

r = call({'magnet': GOOD_MAGNET, 'client': FAKE_EXE})
check('[正面] 合法 magnet + 合法 exe → ok', bool(r) and r.get('ok') is True)
check('[正面] 响应里回传 launched/client/pid',
      bool(r) and r['result'].get('launched') is True and r['result'].get('client') == FAKE_EXE)
check('[正面] Popen 收到的是列表（不走 shell，防命令注入）',
      isinstance(captured.get('args'), list))
check('[正面] magnet 作为独立 argv 元素原样传入',
      captured.get('args') == [FAKE_EXE, GOOD_MAGNET])
check('[正面] Windows 上传 detached 标志（宿主退出后下载器继续活）',
      os.name != 'nt' or bool(captured.get('kwargs', {}).get('creationflags')))

# ---------------------------------------------------------------- 负面：非法 magnet

r = call({'magnet': 'https://example.com/x.torrent', 'client': FAKE_EXE})
check('[magnet] 非 magnet: 前缀 → 拒绝（bad-magnet）',
      bool(r) and r.get('ok') is False and r['error']['code'] == 'bad-magnet')
check('[magnet] 非 magnet: 时不启动任何进程', 'args' not in captured)

r = call({'magnet': '', 'client': FAKE_EXE})
check('[magnet] 空串 → 拒绝', bool(r) and r['error']['code'] == 'bad-magnet')

r = call({'magnet': 'magnet:?xt=urn:btih:' + ('a' * 9000), 'client': FAKE_EXE})
check('[magnet] 超长 → 拒绝（防异常长度）', bool(r) and r['error']['code'] == 'bad-magnet')

r = call({'magnet': 'magnet:?xt=urn:btih:abc\necho pwned', 'client': FAKE_EXE})
check('[magnet] 含换行/控制字符 → 拒绝', bool(r) and r['error']['code'] == 'bad-magnet')
check('[magnet] 含控制字符时不启动进程', 'args' not in captured)

r = call({'magnet': 'magnet:?xt=urn:btih:abc\x00', 'client': FAKE_EXE})
check('[magnet] 含 NUL → 拒绝', bool(r) and r['error']['code'] == 'bad-magnet')

# ---------------------------------------------------------------- 负面：非法 client

r = call({'magnet': GOOD_MAGNET, 'client': ''})
check('[client] 未设置 → client-not-set', bool(r) and r['error']['code'] == 'client-not-set')

r = call({'magnet': GOOD_MAGNET, 'client': 'Thunder.exe'})
check('[client] 相对路径 → client-not-absolute', bool(r) and r['error']['code'] == 'client-not-absolute')

r = call({'magnet': GOOD_MAGNET, 'client': os.path.join(tmpdir, 'missing.exe')})
check('[client] 文件不存在 → client-not-found', bool(r) and r['error']['code'] == 'client-not-found')

r = call({'magnet': GOOD_MAGNET, 'client': FAKE_TXT})
check('[client] 扩展名不在白名单 → client-ext-rejected',
      bool(r) and r['error']['code'] == 'client-ext-rejected')
check('[client] 被拒的扩展名不启动进程', 'args' not in captured)

# 常见注入尝试：指向脚本解释器应被扩展名白名单挡下
FAKE_PS1 = os.path.join(tmpdir, 'evil.ps1')
with open(FAKE_PS1, 'w', encoding='utf-8') as f:
    f.write('Write-Host pwned')
r = call({'magnet': GOOD_MAGNET, 'client': FAKE_PS1})
check('[client] .ps1 被拒（白名单只放行可执行下载器）',
      bool(r) and r['error']['code'] == 'client-ext-rejected')

# ---------------------------------------------------------------- 进程层：帧协议

def frame(obj):
    data = json.dumps(obj).encode('utf-8')
    return struct.pack('<I', len(data)) + data


def read_frame(stream):
    head = stream.read(4)
    if len(head) < 4:
        return None
    (n,) = struct.unpack('<I', head)
    body = stream.read(n)
    return json.loads(body.decode('utf-8'))


proc = subprocess.Popen([sys.executable, HOST_PY],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
out, _err = proc.communicate(frame({'v': 1, 'id': 'p1', 'action': 'ping'}), timeout=30)

# communicate 会关掉 stdin，host 读到 EOF 后正常退出
import io as _io
stream = _io.BytesIO(out)
pong = read_frame(stream)
check('[进程] ping 有响应', bool(pong) and pong.get('id') == 'p1')
check('[进程] ping 返回 ok + pong',
      bool(pong) and pong.get('ok') is True and pong.get('result', {}).get('pong') is True)
check('[进程] 响应带协议版本 v=1', bool(pong) and pong.get('v') == 1)
check('[进程] host 正常退出（EOF 后不挂死）', proc.returncode == 0)


def roundtrip(msgs):
    """一次进程内连发多条，返回响应列表。"""
    payload = b''.join(frame(m) for m in msgs)
    p = subprocess.Popen([sys.executable, HOST_PY],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    o, _e = p.communicate(payload, timeout=30)
    s = _io.BytesIO(o)
    res = []
    while True:
        r = read_frame(s)
        if r is None:
            break
        res.append(r)
    return res


res = roundtrip([
    {'v': 1, 'id': 'a', 'action': 'nope'},
    {'v': 9, 'id': 'b', 'action': 'ping'},
    {'v': 1, 'id': 'c', 'action': 'ping'},
])
check('[进程] 未知 action → unsupported-action',
      len(res) >= 1 and res[0]['error']['code'] == 'unsupported-action')
check('[进程] 协议版本不对 → incompatible-protocol',
      len(res) >= 2 and res[1]['error']['code'] == 'incompatible-protocol')
check('[进程] 后续正常请求仍被处理（不因前一条出错而中断）',
      len(res) >= 3 and res[2].get('ok') is True)

print('\n本机桥（host.py）专项测试全部通过 ✅' if _pass else '\n本机桥（host.py）专项测试存在失败 ❌')
sys.exit(0 if _pass else 1)
