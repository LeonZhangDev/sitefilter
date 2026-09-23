#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""安装 / 卸载 SiteFilter「自定义下载器」本机桥。

做的事（全部在**当前用户**范围内，不需要管理员）：
  1. 生成 host.bat —— 用当前 Python 解释器拉起 host.py（Chrome 的 manifest 不能带启动参数，
     所以需要一个 .bat 当入口）。
  2. 生成 dev.zackzhang.sitefilter_magnet.json —— Native Messaging host 清单，
     allowed_origins 只放行 SiteFilter 扩展。
  3. 写注册表：Chrome 与 Edge 各一处（HKCU，无需管理员）。

用法：
    python native-host/install.py            # 安装（Chrome + Edge）
    python native-host/install.py --uninstall  # 卸载（删注册表项）
    python native-host/install.py --print      # 只打印将写入的清单与注册表路径，不落盘

装完后回到扩展设置页，填好下载器路径（如 C:\\Program Files\\Thunder\\Thunder.exe），
点「测试本机桥」应返回 ok。
"""

import argparse
import json
import os
import subprocess
import sys

HOST_NAME = "dev.zackzhang.sitefilter_magnet"
EXTENSION_ID = "jaihdgjnnpmiabeoefmihmjhoodcjlhf"     # 与 manifest.json 的 key 公钥解出的 ID 一致
HERE = os.path.dirname(os.path.abspath(__file__))
HOST_PY = os.path.join(HERE, "host.py")
HOST_BAT = os.path.join(HERE, "host.bat")
MANIFEST_PATH = os.path.join(HERE, HOST_NAME + ".json")

# 各浏览器的注册表根（HKCU，无需管理员）
REG_ROOTS = {
    "Chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "Edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
    "Chromium": r"Software\Chromium\NativeMessagingHosts",
}


def find_python():
    """优先用带 pythonw 的 python 可执行文件（pythonw 不弹控制台窗口）。"""
    exe = sys.executable or ""
    if exe and exe.lower().endswith("python.exe"):
        pyw = exe[:-len("python.exe")] + "pythonw.exe"
        if os.path.isfile(pyw):
            return pyw
    return exe or "python"


def build_manifest():
    return {
        "name": HOST_NAME,
        "description": "SiteFilter 自定义下载器本机桥（用你指定的下载器打开 magnet:）",
        # 必须绝对路径；Chrome 只接受 .exe / .bat 之类的可执行入口
        "path": HOST_BAT,
        "type": "stdio",
        "allowed_origins": ["chrome-extension://%s/" % EXTENSION_ID],
    }


def write_files(manifest, python_exe):
    # 入口 bat：用 pythonw 跑 host.py，避免每次唤起闪一个黑框
    bat = (
        "@echo off\r\n"
        "rem SiteFilter 自定义下载器本机桥 —— 由 install.py 生成，请勿手改\r\n"
        '"%s" "%s" %%*\r\n' % (python_exe, HOST_PY)
    )
    # 统一 LF/CRLF：Windows 上 .bat 必须是 CRLF，否则 cmd 解析异常
    with open(HOST_BAT, "w", encoding="utf-8", newline="") as f:
        f.write(bat)
    with open(MANIFEST_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")


def install_registry(manifest_path):
    if os.name != "nt":
        print("[!] 非 Windows 系统：请按 README 手工把 host 清单注册到你的浏览器的 "
              "NativeMessagingHosts 目录。")
        return []
    import winreg
    done = []
    for label, root in REG_ROOTS.items():
        key_path = root + "\\" + HOST_NAME
        try:
            with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as k:
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, manifest_path)
            done.append(label)
        except OSError as e:
            print("[!] 写 %s 注册表失败（不影响其它浏览器）：%s" % (label, e))
    return done


def uninstall_registry():
    if os.name != "nt":
        print("[!] 非 Windows 系统：请手工删除 host 清单。")
        return []
    import winreg
    done = []
    for label, root in REG_ROOTS.items():
        key_path = root + "\\" + HOST_NAME
        try:
            winreg.DeleteKeyEx(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE)
            done.append(label)
        except FileNotFoundError:
            pass
        except OSError as e:
            print("[!] 删 %s 注册表失败：%s" % (label, e))
    return done


def main():
    ap = argparse.ArgumentParser(description="安装/卸载 SiteFilter 自定义下载器本机桥")
    ap.add_argument("--uninstall", action="store_true", help="卸载（删注册表项，保留文件）")
    ap.add_argument("--print", dest="print_only", action="store_true", help="只打印不落盘")
    args = ap.parse_args()

    python_exe = find_python()
    manifest = build_manifest()

    if args.print_only:
        print("将写入的 host 清单（%s）：" % MANIFEST_PATH)
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        print("\n解释器：%s" % python_exe)
        print("入口：%s" % HOST_BAT)
        print("注册表（HKCU）：")
        for label, root in REG_ROOTS.items():
            print("  %-9s %s\\%s" % (label, root, HOST_NAME))
        return 0

    if args.uninstall:
        removed = uninstall_registry()
        print("已卸载注册表项：%s" % ("、".join(removed) if removed else "（无）"))
        print("文件保留在 %s，确认不再需要可手工删除。" % HERE)
        return 0

    if not os.path.isfile(HOST_PY):
        print("[!] 找不到 %s" % HOST_PY, file=sys.stderr)
        return 1

    write_files(manifest, python_exe)
    print("已生成：")
    print("  %s" % HOST_BAT)
    print("  %s" % MANIFEST_PATH)
    done = install_registry(MANIFEST_PATH)
    if done:
        print("已注册到：%s" % "、".join(done))
    print("\n下一步：")
    print("  1) 打开扩展设置页 → 通用设置 → 「自定义下载器路径」，填下载器 exe 的绝对路径")
    print("     （如 C:\\Program Files\\Thunder\\Thunder.exe）")
    print("  2) 点旁边的「测试本机桥」，返回 ok 即通")
    print("  3) 重启浏览器（首次注册后需要重启才能让扩展看到本机桥）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
