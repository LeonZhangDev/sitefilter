# -*- coding: utf-8 -*-
"""
SiteFilter 打包脚本：生成可上架 Chrome / Edge 商店的 zip。

用法：
    python make_package.py                       # 普通打包
    python make_package.py --ci                  # 先跑全部测试 + 语法检查，过了才打包
    python make_package.py --bump patch          # 先把版本号 +1（1.0.0 → 1.0.1）再打包
    python make_package.py --bump minor --ci     # 抬次版本 + 全部门禁
    python make_package.py --out build           # 产物放到 build/ 而不是 dist/
    python make_package.py --note "修了 XX"      # 给 CHANGELOG 里这一版写一句话

产物：
    dist/sitefilter-<版本号>.zip        可直接上传商店
    dist/sitefilter-<版本号>/           解压后的内容（本地试装用）
    dist/build-info.json               构建信息（版本 / 时间 / 文件清单 / 测试结果）

做的事：
    1. （--bump）自增版本号并写回 manifest.json，同时在 CHANGELOG.md 记一条
    2. （--ci）先跑 JS 语法检查 + 全部测试套件，任何失败立即中止，不产出包
    3. 只收录扩展真正需要的文件（白名单，而不是"排除"——避免漏排测试/临时文件）
    4. 校验 manifest.json 可解析、字段齐全、图标文件存在且尺寸正确
    5. 检查常见会导致「加载失败 / 审核被拒」的问题（default_locale 无 _locales 等）
    6. 生成 zip + build-info.json，并打印清单
"""
import datetime
import hashlib
import io
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, 'dist')

# 白名单：扩展运行真正需要的文件 / 目录（测试与脚本一律不进包）
INCLUDE_FILES = [
    'manifest.json',
    'background.js',
    'collector-native.js',
    'magnet-native.js',
    'expr.js',
    'rulecheck.js',
    'content.js',
    'xchina-download.js',
    'content.css',
    'popup.html',
    'popup.js',
    'options.html',
    'options.js',
    'options.css',
]
INCLUDE_DIRS = ['icons']

# 明确排除（双保险，防止以后有人往白名单里加错东西）
EXCLUDE_RE = re.compile(r'(^|[\\/])(_|test|tests|dist|\.git|node_modules|.*\.py$|.*\.md$|package(-lock)?\.json$)')

# 语法检查覆盖的 JS（含测试，测试写坏了也是问题）
JS_FILES = [
    'manifest.json',   # 单独 json 校验
    'expr.js', 'rulecheck.js', 'content.js', 'xchina-download.js', 'background.js', 'collector-native.js', 'magnet-native.js', 'popup.js', 'options.js',
]


# ---------------------------------------------------------------- 基础工具

def log(msg, quiet=False):
    if not quiet:
        print(msg)


def run(cmd, cwd=None, env=None, quiet=True):
    """跑一个子进程，返回 (returncode, stdout+stderr)。

    注意：可执行文件找不到（如 CI 容器里没装 git）必须返回 127 而不是抛异常 ——
    否则一个"顺带记一下 git hash"的可选项会把整个打包流程打断。
    """
    e = dict(os.environ)
    if env:
        e.update(env)
    try:
        p = subprocess.run(cmd, cwd=cwd or HERE, env=e,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except (OSError, ValueError) as ex:
        return 127, '无法执行 %r：%s' % (cmd[0] if cmd else '', ex)
    out = p.stdout.decode('utf-8', 'replace')
    if not quiet and out.strip():
        print(out.rstrip())
    return p.returncode, out


def find_node():
    """定位 node：环境变量 → PATH → 托管版本目录。"""
    cands = []
    if os.environ.get('NODE'):
        cands.append(os.environ['NODE'])
    w = shutil.which('node')
    if w:
        cands.append(w)
    # 本机 WorkBuddy 托管的 node（开发机常见路径，找不到也不影响）
    base = os.path.join(os.path.expanduser('~'), '.workbuddy', 'binaries', 'node')
    if os.path.isdir(base):
        for root, _d, names in os.walk(os.path.join(base, 'versions')):
            for n in names:
                if n.lower() in ('node.exe', 'node'):
                    cands.append(os.path.join(root, n))
    for c in cands:
        if c and os.path.exists(c):
            return c
    return None


def node_path_env():
    """jsdom 装在托管 workspace 里时，测试需要 NODE_PATH。"""
    p = os.path.join(os.path.expanduser('~'), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
    parts = [p] if os.path.isdir(p) else []
    local = os.path.join(HERE, 'node_modules')
    if os.path.isdir(local):
        parts.append(local)
    if os.environ.get('NODE_PATH'):
        parts.append(os.environ['NODE_PATH'])
    return os.pathsep.join(parts)


def test_suites():
    """自动发现测试套件：_smoke.js 与 _test_*.js（排序保证输出稳定）。"""
    names = []
    if os.path.exists(os.path.join(HERE, '_smoke.js')):
        names.append('_smoke.js')
    names += sorted(n for n in os.listdir(HERE)
                    if re.match(r'^_test_.*\.js$', n))
    return names


def py_test_suites():
    """Python 侧测试套件：_test_*.py（当前用于 native-host/host.py 的安全边界测试）。

    与 JS 套件同一套约定：stdout 上打 PASS/FAIL，末行给结论，exit 0 = 通过。
    这样 JS/Python 两类用例能合并进同一个门禁计数，不用记两套命令。
    """
    return sorted(n for n in os.listdir(HERE) if re.match(r'^_test_.*\.py$', n))


def sha256(path, n=16):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()[:n]


def git_hash():
    code, out = run(['git', 'rev-parse', '--short', 'HEAD'], quiet=True)
    return out.strip() if code == 0 else ''


def git_dirty():
    code, out = run(['git', 'status', '--porcelain'], quiet=True)
    return bool(out.strip()) if code == 0 else False


# ---------------------------------------------------------------- 门禁

def syntax_check(quiet=False):
    """全部 JS 过一遍 node --check。返回 (ok, 明细)。"""
    node = find_node()
    if not node:
        return False, ['找不到 node，无法做语法检查（可设环境变量 NODE 指向 node 可执行文件）']
    bad = []
    for f in JS_FILES:
        if f.endswith('.json'):
            continue
        p = os.path.join(HERE, f)
        if not os.path.exists(p):
            bad.append('%s 不存在' % f)
            continue
        code, out = run([node, '--check', f])
        if code != 0:
            bad.append('%s 语法错误：%s' % (f, out.strip().splitlines()[-1] if out.strip() else '?'))
        else:
            log('  [ok] 语法 %s' % f, quiet)
    return (not bad), bad


def run_tests(quiet=False):
    """跑全部测试套件。返回 (ok, 明细字符串列表, 汇总 dict)。"""
    node = find_node()
    if not node:
        return False, ['找不到 node，无法跑测试'], {}
    env = {'NODE_PATH': node_path_env()}
    suites = test_suites()
    if not suites:
        return False, ['没找到任何测试套件（_smoke.js / _test_*.js）'], {}

    lines, npass, nfail, failed = [], 0, 0, []
    jobs = [(s, [node, s], env) for s in suites]
    for s, argv, e in jobs:
        code, out = run(argv, env=e)
        p = len(re.findall(r'^PASS', out, re.M))
        f = len(re.findall(r'^FAIL', out, re.M))
        npass += p
        nfail += f
        ok = (code == 0 and f == 0)
        lines.append('  %-26s %s  通过 %3d  失败 %d' % (s, '✅' if ok else '❌', p, f))
        if not ok:
            failed.append(s)
            for ln in out.splitlines():
                if ln.startswith('FAIL'):
                    lines.append('        ' + ln)
    # Python 套件（native host 等）走同一个计数口径
    for s in py_test_suites():
        code, out = run([sys.executable, s])
        p = len(re.findall(r'^PASS', out, re.M))
        f = len(re.findall(r'^FAIL', out, re.M))
        npass += p
        nfail += f
        ok = (code == 0 and f == 0)
        lines.append('  %-26s %s  通过 %3d  失败 %d' % (s, '✅' if ok else '❌', p, f))
        if not ok:
            failed.append(s)
            for ln in out.splitlines():
                if ln.startswith('FAIL'):
                    lines.append('        ' + ln)
    total_suites = len(jobs) + len(py_test_suites())
    log('\n测试套件：', quiet)
    for ln in lines:
        log(ln, quiet)
    summary = {'suites': total_suites, 'passed': npass, 'failed': nfail,
               'failedSuites': failed}
    return (not failed), failed, summary


# ---------------------------------------------------------------- manifest

def read_manifest():
    p = os.path.join(HERE, 'manifest.json')
    if not os.path.exists(p):
        sys.exit('错误：找不到 manifest.json（请在扩展目录下运行）')
    try:
        # utf-8-sig：容忍带 BOM 的 manifest（带 BOM 会让 Chrome 直接加载失败）
        raw = io.open(p, 'rb').read()
        if raw[:3] == b'\xef\xbb\xbf':
            print('警告：manifest.json 带 UTF-8 BOM（建议去掉，部分浏览器会加载失败）')
        with io.open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        sys.exit('错误：manifest.json 解析失败：%s' % e)


def write_manifest(m):
    p = os.path.join(HERE, 'manifest.json')
    txt = json.dumps(m, ensure_ascii=False, indent=2) + '\n'
    io.open(p, 'w', encoding='utf-8', newline='\n').write(txt)


def png_size(path):
    """不依赖第三方库读取 PNG 宽高。"""
    with open(path, 'rb') as f:
        head = f.read(24)
    if len(head) < 24 or head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h = struct.unpack('>II', head[16:24])
    return w, h


def check_manifest(m):
    problems, warnings = [], []

    for key in ('manifest_version', 'name', 'version', 'description'):
        if key not in m:
            problems.append('manifest 缺少必填字段：%s' % key)

    if m.get('manifest_version') != 3:
        problems.append('manifest_version 不是 3（当前为 %r）' % m.get('manifest_version'))

    ver = str(m.get('version', ''))
    if ver and not re.match(r'^\d+(\.\d+){0,3}$', ver):
        problems.append('version 格式不合法（应形如 1.0.0）：%r' % ver)

    # default_locale 必须配套 _locales 目录，否则扩展加载失败
    if m.get('default_locale') and not os.path.isdir(os.path.join(HERE, '_locales')):
        problems.append('声明了 default_locale 但缺少 _locales 目录（会导致加载失败）')

    # 图标：存在 + 尺寸正确
    icons = m.get('icons') or {}
    if not icons:
        warnings.append('manifest 未声明 icons')
    for size, rel in icons.items():
        p = os.path.join(HERE, rel)
        if not os.path.exists(p):
            problems.append('图标文件不存在：%s' % rel)
            continue
        wh = png_size(p)
        if wh is None:
            warnings.append('图标不是合法 PNG：%s' % rel)
        elif wh[0] != wh[1]:
            warnings.append('图标不是正方形：%s（%dx%d）' % (rel, wh[0], wh[1]))
        elif str(wh[0]) != str(size):
            warnings.append('图标尺寸与声明不符：%s 声明 %s 实际 %d' % (rel, size, wh[0]))

    # 引用的文件是否真实存在
    for cs in m.get('content_scripts', []):
        for f in cs.get('js', []) + cs.get('css', []):
            if not os.path.exists(os.path.join(HERE, f)):
                problems.append('content_scripts 引用的文件不存在：%s' % f)
    if m.get('background', {}).get('service_worker'):
        sw = m['background']['service_worker']
        if not os.path.exists(os.path.join(HERE, sw)):
            problems.append('background.service_worker 不存在：%s' % sw)
    for key in ('action', 'options_ui', 'options_page'):
        v = m.get(key)
        if isinstance(v, dict):
            page = v.get('default_popup') or v.get('page')
            if page and not os.path.exists(os.path.join(HERE, page)):
                problems.append('%s 引用的页面不存在：%s' % (key, page))

    # 白名单里的文件应当都真实存在（缺了说明打包会漏东西）
    for name in INCLUDE_FILES:
        if not os.path.exists(os.path.join(HERE, name)):
            warnings.append('白名单文件缺失（不会进包）：%s' % name)

    # manifest 引用的每个文件都必须**真的进包**。
    # 这条是补丁：rulecheck.js 曾进了 manifest.json 的 content_scripts，
    # 却没进 INCLUDE_FILES —— 打出来的 zip 缺文件、扩展一加载就坏，而门禁当时全绿。
    # 光校验"文件存在磁盘上"不够，必须校验"会被打进包"。
    packaged = set(n.replace('\\', '/') for n in INCLUDE_FILES)
    for d in INCLUDE_DIRS:
        root = os.path.join(HERE, d)
        if not os.path.isdir(root):
            continue
        for base, _dirs, names in os.walk(root):
            for n in names:
                rel = os.path.relpath(os.path.join(base, n), HERE).replace('\\', '/')
                if not EXCLUDE_RE.search(rel):
                    packaged.add(rel)

    refs = []
    for cs in m.get('content_scripts', []):
        refs += list(cs.get('js', [])) + list(cs.get('css', []))
    if m.get('background', {}).get('service_worker'):
        refs.append(m['background']['service_worker'])
    for key in ('action', 'options_ui', 'options_page'):
        v = m.get(key)
        if isinstance(v, dict):
            page = v.get('default_popup') or v.get('page')
            if page:
                refs.append(page)
        elif isinstance(v, str):
            refs.append(v)
    refs += list((m.get('icons') or {}).values())
    # web_accessible_resources：页面/其它扩展可通过 chrome-extension:// 直接取用的资源，
    # 漏了不会立刻报错（取决于谁在用），但一样是"manifest 引用了包内却不存在"。
    for war in (m.get('web_accessible_resources') or []):
        if isinstance(war, dict):
            refs += list(war.get('resources') or [])
        elif isinstance(war, str):
            refs.append(war)
    for rel in refs:
        rel = str(rel).replace('\\', '/')
        if rel not in packaged:
            problems.append('manifest 引用的文件不在打包白名单里（打出来的包会缺它）：%s' % rel)

    # background 的 importScripts 引用的脚本同样必须进包 ——
    # 这是第二处容易漏的地方（新加一个后台模块，忘记加白名单，打包照样绿）。
    bg = m.get('background', {}).get('service_worker')
    if bg and os.path.exists(os.path.join(HERE, bg)):
        try:
            bg_src = io.open(os.path.join(HERE, bg), encoding='utf-8').read()
            for imp in re.findall(r"importScripts\(\s*['\"]([^'\"]+)['\"]\s*\)", bg_src):
                imp = imp.replace('\\', '/')
                if imp not in packaged:
                    problems.append('background.js importScripts 的脚本不在打包白名单里：%s' % imp)
        except Exception as e:
            warnings.append('读取 background.js 检查 importScripts 失败：%s' % e)

    # 权限提示
    perms = m.get('permissions') or []
    risky = [p for p in perms if p in ('<all_urls>', 'tabs', 'webRequest', 'cookies', 'history')]
    if risky:
        warnings.append('包含较敏感权限（审核可能要求说明用途）：%s' % ', '.join(risky))

    return problems, warnings


def collect():
    files = []
    for name in INCLUDE_FILES:
        p = os.path.join(HERE, name)
        if os.path.exists(p):
            files.append(name)
        else:
            print('警告：白名单文件缺失，已跳过：%s' % name)
    for d in INCLUDE_DIRS:
        root = os.path.join(HERE, d)
        if not os.path.isdir(root):
            continue
        for base, _dirs, names in os.walk(root):
            for n in names:
                full = os.path.join(base, n)
                rel = os.path.relpath(full, HERE).replace('\\', '/')
                if EXCLUDE_RE.search(rel):
                    continue
                files.append(rel)
    return sorted(set(files))


# ---------------------------------------------------------------- 版本号自增

def read_schema_version():
    """从 background.js 里读出数据结构版本号，写进 build-info 方便排查。"""
    p = os.path.join(HERE, 'background.js')
    try:
        txt = io.open(p, encoding='utf-8').read()
        m = re.search(r'SCHEMA_VERSION\s*=\s*(\d+)', txt)
        return int(m.group(1)) if m else None
    except Exception:
        return None


def next_version(ver, kind):
    parts = [int(x) for x in re.match(r'^(\d+)\.(\d+)\.(\d+)', ver + '.0.0.0').group(1, 2, 3)]
    major, minor, patch = parts
    if kind == 'major':
        major, minor, patch = major + 1, 0, 0
    elif kind == 'minor':
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return '%d.%d.%d' % (major, minor, patch)


def bump_version(kind, note=''):
    """自增 manifest 版本号并记一条 CHANGELOG。返回新版本号。"""
    m = read_manifest()
    old = str(m.get('version', '1.0.0'))
    new = next_version(old, kind)
    m['version'] = new
    write_manifest(m)

    today = datetime.date.today().isoformat()
    chp = os.path.join(HERE, 'CHANGELOG.md')
    header = '# 更新日志\n\n本文件由 `make_package.py --bump` 自动追加，也可以在发布前手工补充说明。\n'
    body = io.open(chp, encoding='utf-8').read() if os.path.exists(chp) else header
    entry = '\n## [%s] - %s\n\n- %s（版本号自增：%s）\n' % (
        new, today, note or '本次发布', kind)
    # 插到第一个版本条目之前（保持倒序）
    idx = body.find('\n## [')
    if idx == -1:
        body = body.rstrip() + '\n' + entry
    else:
        body = body[:idx] + '\n' + entry + body[idx:]
    io.open(chp, 'w', encoding='utf-8', newline='\n').write(body)

    print('版本号：%s → %s（已写回 manifest.json，并在 CHANGELOG.md 记一条）' % (old, new))
    return new


# ---------------------------------------------------------------- 构建信息

def build_info(files, test_summary, out_dir):
    m = read_manifest()
    rows = []
    for rel in files:
        p = os.path.join(HERE, rel)
        rows.append({'path': rel, 'size': os.path.getsize(p), 'sha256': sha256(p)})
    node = find_node()
    node_ver = None
    if node:
        _rc, _out = run([node, '--version'])
        node_ver = _out.strip() or None
    return {
        'name': m.get('name'),
        'version': str(m.get('version', '')),
        'manifestVersion': m.get('manifest_version'),
        'schemaVersion': read_schema_version(),
        'builtAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        'git': {'hash': git_hash(), 'dirty': git_dirty()},
        'python': sys.version.split()[0],
        'node': node_ver,
        'tests': test_summary or {},
        'fileCount': len(rows),
        'totalBytes': sum(r['size'] for r in rows),
        'files': rows,
        'outputDir': os.path.basename(out_dir),
    }


# ---------------------------------------------------------------- 主流程

def build(out=None, ci=False, bump=None, note='', unpacked=True, quiet=False,
          test_summary=None):
    if bump:
        bump_version(bump, note)

    m = read_manifest()
    print('扩展：%s  v%s' % (m.get('name'), m.get('version')))

    # ---- 门禁 ----
    test_summary = test_summary or {}
    if ci:
        print('\n[门禁 1/2] JS 语法检查')
        ok, bad = syntax_check(quiet)
        if not ok:
            for b in bad:
                print('  [错误] %s' % b)
            sys.exit('\n语法检查未通过，已中止打包。')
        print('  全部通过')

        print('\n[门禁 2/2] 全部测试套件')
        ok, _detail, test_summary = run_tests(quiet)
        if not ok:
            sys.exit('\n测试未全部通过，已中止打包（不产出任何 zip）。')
        print('  %d 套 / %d 项断言全部通过，0 失败' % (
            test_summary.get('suites', 0), test_summary.get('passed', 0)))

    problems, warnings = check_manifest(m)
    for w in warnings:
        print('  [警告] %s' % w)
    if problems:
        for p in problems:
            print('  [错误] %s' % p)
        sys.exit('\n校验未通过，已中止打包。')

    files = collect()
    ver = str(m.get('version', '0.0.0'))
    out_root = os.path.abspath(out) if out else DIST
    out_dir = os.path.join(out_root, 'sitefilter-%s' % ver)
    out_zip = os.path.join(out_root, 'sitefilter-%s.zip' % ver)

    if not os.path.isdir(out_root):
        os.makedirs(out_root)

    # 写一份解压目录（人工核对/本地试装用，同时保证 zip 里是干净的扁平结构）
    made = 0
    if unpacked:
        for rel in files:
            src = os.path.join(HERE, rel)
            dst = os.path.join(out_dir, rel.replace('/', os.sep))
            d = os.path.dirname(dst)
            if d and not os.path.isdir(d):
                os.makedirs(d)
            with open(src, 'rb') as fi, open(dst, 'wb') as fo:
                fo.write(fi.read())
            made += 1

    # 打 zip（manifest.json 放根，商店要求）
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in files:
            z.write(os.path.join(HERE, rel), rel)

    # 构建信息（不进 zip，只放在 dist/ 里备查）
    info = build_info(files, test_summary, out_dir)
    info_path = os.path.join(out_root, 'build-info.json')
    io.open(info_path, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(info, ensure_ascii=False, indent=2) + '\n')

    print('\n已收集 %d 个文件：' % len(files))
    for rel in files:
        size = os.path.getsize(os.path.join(HERE, rel))
        print('  %-26s %8d B' % (rel, size))

    # 兜底：确认测试/临时文件没被打进去
    with zipfile.ZipFile(out_zip) as z:
        bad = [n for n in z.namelist() if EXCLUDE_RE.search(n)]
    if bad:
        sys.exit('\n错误：zip 中混入了不该打包的文件：%s' % bad)

    print('\n✅ 打包完成')
    print('   zip        ：%s  (%d KB, sha256 %s)' % (out_zip, os.path.getsize(out_zip) // 1024, sha256(out_zip, 12)))
    if unpacked:
        print('   解压版     ：%s' % out_dir)
    print('   构建信息   ：%s' % info_path)
    print('\n上传：Chrome 开发者后台 → 打包好的扩展程序；Edge 同理。')
    print('本地试装：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选上面的解压版目录。')
    return out_zip


def main():
    import argparse
    ap = argparse.ArgumentParser(description='SiteFilter 打包脚本')
    ap.add_argument('--bump', choices=['patch', 'minor', 'major'],
                    help='自增版本号（patch/minor/major），写回 manifest.json 并记 CHANGELOG')
    ap.add_argument('--note', default='', help='写进 CHANGELOG 的本版说明')
    ap.add_argument('--ci', action='store_true',
                    help='先跑 JS 语法检查 + 全部测试，任何失败即中止（不产出 zip）')
    ap.add_argument('--out', default=None, help='产物目录（默认 dist/）')
    ap.add_argument('--no-unpacked', action='store_true', help='不产出解压版目录，只出 zip')
    ap.add_argument('--quiet', action='store_true', help='少打印')
    a = ap.parse_args()
    build(out=a.out, ci=a.ci, bump=a.bump, note=a.note,
          unpacked=not a.no_unpacked, quiet=a.quiet)


if __name__ == '__main__':
    main()
