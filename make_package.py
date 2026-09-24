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
    'site-templates.js',
    'magnet-core.js',
    'content.js',
    'xchina-download.js',
    'content.css',
    'popup.html',
    'popup.js',
    'options.html',
    'options.js',
    'options.css',
]
INCLUDE_DIRS = ['icons', 'native-host']

# 目录白名单里**显式放行**的文件。
# EXCLUDE_RE 那条 `.*\.py$ / .*\.md$` 是为根目录的测试与脚本设的，可它对
# native-host/ 一视同仁 —— 而设置页让用户「运行 native-host/install.py」，
# 于是这三个文件必须真的进包：否则从 zip 装的用户根本找不到 install.py，
# Tier B 对他们实际不可用，而我们的门禁还全绿。
INCLUDE_DIR_EXTRA = [
    'native-host/host.py',
    'native-host/install.py',
    'native-host/README.md',   # zip 里 Tier B 唯一的安装说明
]

# Tier B 能用的前提。缺了不会有任何报错，只在用户那里表现为「照提示找不到文件」。
NATIVE_HOST_REQUIRED = ['native-host/host.py', 'native-host/install.py']

# 明确排除（双保险，防止以后有人往白名单里加错东西）
EXCLUDE_RE = re.compile(r'(^|[\\/])(_|test|tests|dist|\.git|node_modules|.*\.py$|.*\.md$|package(-lock)?\.json$)')

# 语法检查覆盖的 JS（含测试，测试写坏了也是问题）
JS_FILES = [
    'manifest.json',   # 单独 json 校验
    'expr.js', 'rulecheck.js', 'magnet-core.js', 'site-templates.js', 'content.js', 'xchina-download.js', 'background.js', 'collector-native.js', 'magnet-native.js', 'popup.js', 'options.js',
]

# 需要做「包内引用」校验的页面：manifest 只声明"有哪些页面"，
# 页面自己再引用什么它管不着 —— 所以这几页要单独扫一遍（见 check_manifest）。
HTML_PAGES = ['options.html', 'popup.html']
HTML_LOCAL_RE = re.compile(
    r'<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["\']([^"\']+)["\']', re.I)

# 门禁自己读、但不属于"进包文件 / 测试套件"那两类的文件。
# 少一个 CI 就跑不起来，且报出来的错通常与真实原因无关。
GATE_SELF_FILES = [
    'ci.py', 'make_package.py', 'package.json', 'package-lock.json',
    '.githooks/pre-push', '.gitattributes', '_load.js',
    'README.md', 'CHANGELOG.md',
    'docs/progress.md', 'docs/verify/manual-acceptance.md',
]
# workflow 不写上面那张清单里，而是扫目录 —— 见 workflow_files()。


def workflow_files():
    """`.github/workflows/` 下的每个 yml，都算「门禁依赖的文件」。

    它们不是门禁读来跑的脚本，而是**门禁能在 CI 里生效的载体**：少跟踪一个，
    那条 workflow 在 GitHub 上根本不存在（静默失效 —— 看着仓库有 CI，其实没有），
    而本地毫无感觉。反过来，`_test_assembly.js` 会读它们做守卫，CI 里缺一个就崩。

    目录是唯一事实来源：新增 workflow 自动纳入，不用回来改这张清单
    （清单漏加正是本项目反复发作的病）。
    """
    d = os.path.join(HERE, '.github', 'workflows')
    if not os.path.isdir(d):
        return []
    return sorted('.github/workflows/' + f for f in os.listdir(d)
                  if f.endswith(('.yml', '.yaml')))


# ---------------------------------------------------------------- 基础工具

def is_packable(rel):
    """某个路径是否会被打进包 —— **唯一**判据。

    collect()（真打包）/ check_manifest()（打包前校验）/ 打包后的 zip 兜底
    三处都必须走这里。以前它们各写各的过滤（两次 os.walk + 一次扫 zip），
    一漂移就会出现「门禁说覆盖了、包里其实没有」；rulecheck.js 漏配那次
    是同一个病的另一种发作。
    """
    rel = str(rel).replace('\\', '/')
    return rel in INCLUDE_DIR_EXTRA or not EXCLUDE_RE.search(rel)


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


# 套件崩溃时回显末尾多少行输出。定成常量是为了让「崩溃不留线索」这件事可被断言。
CRASH_TAIL_LINES = 12


def classify_suite(code, out):
    """把一个测试套件的 (退出码, 输出) 归类。**纯函数**，供 _test_ci_gate.py 直接断言。

    四种结局，每一种都必须能从输出里分辨出来 —— 第四种以前会被记成"全过"：

      'ok'     全过
      'fail'   有断言失败（打印了 FAIL 行）
      'crash'  崩了：exit≠0 且一行 FAIL 都没有（抛异常 / 找不到文件 / 语法错）
      'empty'  exit 0，但**一条断言都没打印**（提前 return、被条件整段跳过、收尾丢了）

    'empty' 是这套判据里最阴的一种：它看起来和 'ok' 一模一样（exit 0、零 FAIL），
    于是被记成「✅ 通过 0 失败 0」—— 也就是说 **测试文件被改坏到一条都不跑，
    门禁反而全绿**。这和以前 'crash' 被门禁自己吞掉是同一类病：判据本身有盲区。

    为什么必须是纯函数：上一版这段逻辑藏在 run_tests() 的内层闭包里，守卫只能用
    正则去 make_package.py 里找 CRASH_TAIL_LINES 这样的字符串 —— 那不是测试，
    是"检查源码里有这几个词"。抽出来才能真喂假输出进去断言分类结果。
    """
    p = len(re.findall(r'^PASS', out, re.M))
    f = len(re.findall(r'^FAIL', out, re.M))
    if code != 0 and f == 0:
        verdict = 'crash'
    elif code != 0 or f > 0:
        verdict = 'fail'
    elif p == 0:
        verdict = 'empty'
    else:
        verdict = 'ok'
    return {'verdict': verdict, 'passed': p, 'failed': f, 'code': code,
            'ok': verdict == 'ok'}


VERDICT_MARK = {'ok': '✅', 'fail': '❌', 'crash': '💥', 'empty': '⚠️'}


def run_tests(quiet=False):
    """跑全部测试套件。返回 (ok, 明细字符串列表, 汇总 dict)。"""
    node = find_node()
    if not node:
        return False, ['找不到 node，无法跑测试'], {}
    env = {'NODE_PATH': node_path_env()}
    suites = test_suites()
    if not suites:
        return False, ['没找到任何测试套件（_smoke.js / _test_*.js）'], {}

    lines, failed, crashed, empty = [], [], [], []
    npass, nfail = 0, 0

    def record(name, code, out):
        """把一个套件的结果记进汇总（JS / Python 共用同一口径）。判据见 classify_suite()。

        三种坏结局都必须留下线索，因为它们以前都留过"假绿"：
          ❌ 断言失败 → 印 FAIL 行
          💥 崩了     → exit≠0 却一行 FAIL 都没有，以前只在「失败>0」时收集明细，
                        于是 CI 日志只剩「❌ 通过 0 失败 0」，得单独跑才知道为什么
          ⚠️ 空跑     → exit 0 且零断言，以前**直接记成 ✅**
        """
        r = classify_suite(code, out)
        p, f = r['passed'], r['failed']
        nonlocal npass, nfail
        npass += p
        nfail += f
        lines.append('  %-26s %s  通过 %3d  失败 %d%s' % (
            name, VERDICT_MARK[r['verdict']], p, f,
            '   exit=%d' % code if r['verdict'] == 'crash' else ''))
        if r['ok']:
            return
        failed.append(name)
        for ln in out.splitlines():
            if ln.startswith('FAIL'):
                lines.append('        ' + ln)
        if r['verdict'] == 'crash':
            crashed.append(name)
            body = [l for l in out.rstrip().splitlines() if l.strip()]
            lines.append('        ↑ 一条断言都没跑完（exit %d），末尾 %d 行输出：'
                         % (code, min(CRASH_TAIL_LINES, len(body))))
            for ln in body[-CRASH_TAIL_LINES:]:
                lines.append('        | ' + ln[:220])
        elif r['verdict'] == 'empty':
            empty.append(name)
            lines.append('        ↑ exit 0 但一条断言都没打印 —— 脚本被整段跳过或提前收尾了。'
                         '这种情况以前会被记成「✅ 通过 0 失败 0」，只看日志根本发现不了。')

    jobs = [(s, [node, s], env) for s in suites]
    for s, argv, e in jobs:
        code, out = run(argv, env=e)
        record(s, code, out)
    # Python 套件（native host 等）走同一个计数口径
    py = py_test_suites()
    for s in py:
        code, out = run([sys.executable, s])
        record(s, code, out)

    total_suites = len(jobs) + len(py)
    log('\n测试套件：', quiet)
    for ln in lines:
        log(ln, quiet)
    if crashed:
        log('\n注意：有 %d 个套件是「崩溃」而不是「断言失败」—— 上面已附它们的末尾输出。'
            % len(crashed), quiet)
    if empty:
        log('\n注意：有 %d 个套件一条断言都没跑（exit 0）—— 门禁按失败处理。'
            % len(empty), quiet)
    summary = {'suites': total_suites, 'passed': npass, 'failed': nfail,
               'failedSuites': failed, 'crashedSuites': crashed,
               'emptySuites': empty}
    return (not failed), failed, summary


def check_git_tracking(quiet=False):
    """门禁依赖的文件必须都已纳入 git。返回 (ok, problems, warnings)。

    这是「本地绿、CI 红」的**通类**，不只是那 12 个硬编码路径那一次：
    CI 是一次全新 checkout，**只有被 git 跟踪的文件存在**；本地却还有未跟踪的、
    以及被 .gitignore 悄悄挡掉的。于是本地能全绿，推到远端立刻红，而两边看到的
    现象完全不同（本地：一切正常；CI：文件不存在）。

    两种漏法，都会静默发生：
      · 新加文件后忘了 `git add`（提交时少 add 一个文件就够）；
      · 路径恰好命中 .gitignore —— 本项目有 `*.zip` / `dist/` / `build*/`（带斜杠，
        **只忽略目录**）/ `artifacts/...`。比如把新模块放进 `build/` 下、或起个
        `.zip` 后缀的名字，本地永远正常，CI 永远红。

    没装 git / 不是仓库时给一条警告放行：环境缺失不是代码问题，拿它拦人只会
    逼出 `--no-verify`，把守卫本身废掉。
    """
    code, out = run(['git', 'ls-files'], quiet=True)
    if code != 0:
        return True, [], ['跳过 git 跟踪校验（这里不是 git 仓库，或环境里没有 git）']

    tracked = set(l.strip().replace('\\', '/') for l in out.splitlines() if l.strip())
    needed = set(collect(quiet=True))
    needed.update(test_suites())
    needed.update(py_test_suites())
    needed.update(GATE_SELF_FILES)
    needed.update(workflow_files())

    problems = []
    for rel in sorted(needed):
        if not os.path.exists(os.path.join(HERE, rel)):
            problems.append('门禁需要的文件不存在：%s' % rel)
            continue
        if rel in tracked:
            continue
        icode, _ = run(['git', 'check-ignore', '-q', rel], quiet=True)
        if icode == 0:
            problems.append('%s 被 .gitignore 忽略 —— 本地在，CI 的 checkout 里没有' % rel)
        else:
            problems.append('%s 还没纳入 git —— 本地在，CI 的 checkout 里没有' % rel)
    return (not problems), problems, []


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
    for name in INCLUDE_FILES + INCLUDE_DIR_EXTRA:
        if not os.path.exists(os.path.join(HERE, name)):
            warnings.append('白名单文件缺失（不会进包）：%s' % name)

    # manifest 引用的每个文件都必须**真的进包**。
    # 这条是补丁：rulecheck.js 曾进了 manifest.json 的 content_scripts，
    # 却没进 INCLUDE_FILES —— 打出来的 zip 缺文件、扩展一加载就坏，而门禁当时全绿。
    # 光校验"文件存在磁盘上"不够，必须校验"会被打进包"。
    # 「会进包的文件」只有一个来源（collect），别在这里再算一遍
    packaged = set(collect(quiet=True))

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

    # 页面 HTML 里 <script src> / <link href> 引用的本地文件同样必须进包。
    # manifest 只声明"有哪些页面"，页面自己再引用什么它管不着 —— 所以这条得单独扫。
    # 漏了它的后果和 rulecheck.js 那次一模一样（新加一个共享模块、忘了加白名单，
    # 包缺文件、扩展一加载就坏），只是入口从 manifest 换成了 HTML。
    for page in HTML_PAGES:
        ppath = os.path.join(HERE, page)
        if not os.path.exists(ppath):
            continue
        try:
            html = io.open(ppath, encoding='utf-8').read()
        except Exception as e:
            warnings.append('读取 %s 校验其内部引用失败：%s' % (page, e))
            continue
        for ref in HTML_LOCAL_RE.findall(html):
            if re.match(r'^(?:[a-z][a-z0-9+.-]*:)?//', ref, re.I) or ref.startswith('data:') \
                    or ref.startswith('#') or ref.startswith('{{'):
                continue                      # 外链 / data: / 页内锚点 / 模板占位
            rel = ref.split('?')[0].split('#')[0].replace('\\', '/')
            while rel.startswith('./'):
                rel = rel[2:]
            if rel and rel not in packaged:
                problems.append('%s 引用的文件不在打包白名单里（包会缺它）：%s' % (page, rel))

    # Tier B（指定下载器）的本机代理必须真的进包。
    # 这不是漂亮话：INCLUDE_DIRS 曾经只有 icons，打出来的 zip 里没有 native-host/，
    # 而设置页照样写着「请先运行 native-host/install.py」—— 用户照提示找不到文件，
    # 功能静默不可用，本地门禁却全绿。
    for rel in NATIVE_HOST_REQUIRED:
        if rel not in packaged:
            problems.append('Tier B 的本机代理没进包（用户拿不到它）：%s' % rel)

    # 权限提示
    perms = m.get('permissions') or []
    risky = [p for p in perms if p in ('<all_urls>', 'tabs', 'webRequest', 'cookies', 'history')]
    if risky:
        warnings.append('包含较敏感权限（审核可能要求说明用途）：%s' % ', '.join(risky))

    return problems, warnings


def collect(quiet=False):
    """会进包的文件清单。判据见 is_packable() —— 别在这里再写一套过滤。"""
    files = []
    for name in INCLUDE_FILES + INCLUDE_DIR_EXTRA:
        p = os.path.join(HERE, name)
        if os.path.exists(p):
            files.append(name)
        elif not quiet:
            print('警告：应进包的文件缺失，已跳过：%s' % name)
    for d in INCLUDE_DIRS:
        root = os.path.join(HERE, d)
        if not os.path.isdir(root):
            continue
        for base, _dirs, names in os.walk(root):
            for n in names:
                rel = os.path.relpath(os.path.join(base, n), HERE).replace('\\', '/')
                if is_packable(rel):
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

    # 兜底：确认测试/临时文件没被打进去（native-host/ 的显式放行见 is_packable）
    with zipfile.ZipFile(out_zip) as z:
        bad = [n for n in z.namelist() if not is_packable(n)]
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
