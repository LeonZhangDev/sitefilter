#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SiteFilter —— 「自定义下载器」本机桥（Native Messaging host）。

只做一件事：把扩展传来的 magnet: 交给你在设置里指定的下载器 exe 打开。
（浏览器扩展无法自己启动任意 exe，所以必须有这么个本机小程序。）

协议：Chrome Native Messaging —— stdin/stdout 上「4 字节小端长度 + UTF-8 JSON」。
  请求示例：
    {"v":1,"id":"sfm-xxx","action":"open-magnet",
     "payload":{"magnet":"magnet:?xt=urn:btih:...","client":"C:\\\\Program Files\\\\Thunder\\\\Thunder.exe"}}
  成功响应：
    {"v":1,"id":"sfm-xxx","ok":true,"result":{"launched":true,"client":"...","pid":1234}}
  失败响应：
    {"v":1,"id":"sfm-xxx","ok":false,
     "error":{"code":"client-not-found","message":"...","retriable":false}}

安全边界（这个进程能被扩展唤起，所以刻意收紧）：
  · 只有注册在 allowed_origins 里的扩展能连上（见生成的 manifest）。
  · 只接受 open-magnet / ping 两个 action，其它一律拒绝。
  · magnet 必须是 ``magnet:?`` 开头、长度受限、无控制字符。
  · client 必须是**绝对路径**、真实存在的**文件**、扩展名在白名单里。
  · 用 subprocess.Popen(list) 启动，**不走 shell** —— 参数不会被当命令解析。
  · 启动的进程 DETACHED，宿主退出后下载器继续活。
"""

import json
import os
import struct
import subprocess
import sys

PROTOCOL_VERSION = 1
ALLOWED_ACTIONS = {"open-magnet", "ping"}
# 只允许这些扩展名：都是"下载器本体"，避免被利用去拉起任意脚本/解释器
ALLOWED_EXT = {".exe", ".com", ".bat", ".cmd", ".lnk"}
MAX_MAGNET_LEN = 8192
MAGNET_PREFIX = "magnet:?"


def _log(msg):
    """诊断日志写到 stderr（不会污染 native messaging 的 stdout 协议流）。"""
    try:
        sys.stderr.write("[sitefilter-magnet] %s\n" % msg)
        sys.stderr.flush()
    except Exception:
        pass


def read_message():
    """读一条 native messaging 消息；stdin 关闭时返回 None。"""
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    (length,) = struct.unpack("<I", raw_len)
    if length == 0:
        return None
    if length > 64 * 1024 * 1024:      # 单条上限 64MB，防异常长度
        _log("message too large: %d" % length)
        return None
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except Exception as e:
        _log("bad json: %r" % (e,))
        return None


def write_message(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def reply_ok(msg_id, result):
    write_message({"v": PROTOCOL_VERSION, "id": msg_id, "ok": True, "result": result})


def reply_err(msg_id, code, message, retriable=False):
    write_message({
        "v": PROTOCOL_VERSION, "id": msg_id, "ok": False,
        "error": {"code": code, "message": message, "retriable": bool(retriable)},
    })


def validate_magnet(magnet):
    if not isinstance(magnet, str) or not magnet:
        return "magnet 为空。"
    if len(magnet) > MAX_MAGNET_LEN:
        return "magnet 过长（超过 %d 字符）。" % MAX_MAGNET_LEN
    if not magnet.lower().startswith(MAGNET_PREFIX):
        return "不是合法的 magnet 链接（应以 magnet:? 开头）。"
    # 控制字符（含换行/NUL）一律拒绝：正常磁力串里不会出现，出现即异常输入
    for ch in magnet:
        if ord(ch) < 0x20 or ord(ch) == 0x7F:
            return "magnet 含控制字符，已拒绝。"
    return None


def validate_client(client):
    if not isinstance(client, str) or not client.strip():
        return "client-not-set", "没有指定下载器路径。"
    client = client.strip().strip('"')
    if not os.path.isabs(client):
        return "client-not-absolute", "下载器路径必须是绝对路径。"
    if not os.path.isfile(client):
        return "client-not-found", "找不到下载器：%s（请检查路径是否正确、是否已安装）。" % client
    ext = os.path.splitext(client)[1].lower()
    if ext not in ALLOWED_EXT:
        return "client-ext-rejected", "只允许启动 %s 类型的文件，拒绝：%s" % (
            "/".join(sorted(ALLOWED_EXT)), ext or "(无扩展名)")
    return None, client


def handle_open_magnet(msg_id, payload):
    payload = payload or {}
    magnet = payload.get("magnet")
    client = payload.get("client")

    err = validate_magnet(magnet)
    if err:
        reply_err(msg_id, "bad-magnet", err)
        return

    code, client_or_msg = validate_client(client)
    if code:
        reply_err(msg_id, code, client_or_msg)
        return
    client = client_or_msg

    # 不走 shell：magnet 作为独立的 argv 元素传入，绝不会被当命令解析
    kwargs = {"close_fds": True}
    if os.name == "nt":
        # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP：宿主退出后下载器继续活，
        # 且不弹控制台窗口
        kwargs["creationflags"] = 0x00000008 | 0x00000200
    try:
        proc = subprocess.Popen([client, magnet], **kwargs)
    except Exception as e:
        reply_err(msg_id, "launch-failed", "启动下载器失败：%s" % e)
        return

    _log("launched pid=%s client=%s" % (proc.pid, client))
    reply_ok(msg_id, {"launched": True, "client": client, "pid": proc.pid})


def handle_ping(msg_id):
    reply_ok(msg_id, {
        "pong": True,
        "host": "sitefilter_magnet",
        "protocol": PROTOCOL_VERSION,
        "python": sys.version.split()[0],
    })


def main():
    while True:
        msg = read_message()
        if msg is None:
            break
        if not isinstance(msg, dict):
            continue
        msg_id = msg.get("id")
        action = msg.get("action")
        if msg.get("v") != PROTOCOL_VERSION:
            reply_err(msg_id, "incompatible-protocol", "协议版本不兼容，请更新扩展或重跑安装脚本。")
            continue
        if action not in ALLOWED_ACTIONS:
            reply_err(msg_id, "unsupported-action", "不支持的 action：%r" % (action,))
            continue
        try:
            if action == "ping":
                handle_ping(msg_id)
            else:
                handle_open_magnet(msg_id, msg.get("payload"))
        except Exception as e:                      # 任何未预期异常都不能让宿主崩死
            _log("handler error: %r" % (e,))
            reply_err(msg_id, "internal-error", "本机桥内部错误：%s" % e)


if __name__ == "__main__":
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
