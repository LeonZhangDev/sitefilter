#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""门禁自身的测试 —— 「门禁也被门禁管」的那一环。

为什么需要这一套：`make_package.py` 里判定"一个套件算不算通过"的逻辑，
以前藏在内层闭包里，守卫只能用正则去文件里找 `CRASH_TAIL_LINES` 这样的
**字符串** —— 那不是测试，是"检查源码里有这几个词"。改坏了逻辑、留下那几个词，
守卫照样绿。

这里的每一条都是**行为断言**：喂 (退出码, 输出) 进去，断言分类结果。
钉死四种结局，尤其是两种会变成"假绿"的：

  · 'crash'  exit≠0 且一行 FAIL 都没有 —— 以前门禁只在「失败>0」时收集明细，
            于是 CI 日志只剩「❌ 通过 0 失败 0」，真相被门禁自己吞掉；
  · 'empty'  exit 0 且**一条断言都没打印** —— 以前直接记成「✅ 通过 0 失败 0」。
            也就是说：**测试文件被改坏到一条都不跑，门禁反而全绿**。

另外测新加的 `check_git_tracking()`（"本地绿、CI 红"的通类）——
它是用两个真实场景测的：文件被 .gitignore 吃掉、以及文件没 git add。
"""
import os
import sys

sys.dont_write_bytecode = True          # 不往仓库里留 __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import inspect                # noqa: E402
import make_package as mp     # noqa: E402

_pass = True


def check(name, cond):
    global _pass
    print(('PASS  ' if cond else 'FAIL  ') + name)
    if not cond:
        _pass = False


# 有些断言必须真的有一个 git 仓库才成立（探针验证「没 add 会被抓到」之类）。
# 没有 git 时它们会**假红** —— 而 CI 里 `actions/checkout` 一定会建 `.git`，
# 所以这些断言在 CI 一定真跑。把源码当 zip 下载、或复制时排除了 `.git`，
# 都属于「环境缺失」，按本仓库口径放行（`check_git_tracking()` 自己也是这么做的：
# 拿环境问题拦人，只会逼出 `--no-verify`，把守卫废掉）。
#
# ⚠️ 跳过会打印 `SKIP`，而 `classify_suite()` 只数行首的 PASS/FAIL ⇒ 跳过的断言
#    不计入断言总数，也不会把「一条都没跑」伪装成通过（那种是 `empty`，判红）。
_gc, _go = mp.run(['git', 'rev-parse', '--is-inside-work-tree'], quiet=True)
IN_GIT = (_gc == 0 and 'true' in _go)


def check_git(name, cond):
    if not IN_GIT:
        print('SKIP  ' + name + '（本环境不是 git 仓库；CI 里 actions/checkout 一定建 .git）')
        return
    check(name, cond)


# ================================================================ 1. classify_suite
# 纯函数，直接喂假输出。表格形式写，新增结局时一眼看得出漏了哪一格。
CASES = [
    # (说明, 退出码, 输出, 期望 verdict, 期望 passed, 期望 failed)
    ('全过：exit 0 + 有断言',
     0, 'PASS  a\nPASS  b\nPASS  c\n', 'ok', 3, 0),
    ('断言失败：有 FAIL 行',
     0, 'PASS  a\nFAIL  b\n', 'fail', 1, 1),
    ('断言失败 + 非零退出码 → 仍是 fail，不是 crash',
     1, 'PASS  a\nFAIL  b\n', 'fail', 1, 1),
    ('崩溃：exit 1 且一行 FAIL 都没有',
     1, 'Traceback (most recent call last):\n  at foo (_test_x.js:1:1)\n', 'crash', 0, 0),
    ('崩溃：exit 127（找不到 node/命令）',
     127, 'node: command not found\n', 'crash', 0, 0),
    ('空跑：exit 0 且零断言 —— 以前会被记成 ✅',
     0, '', 'empty', 0, 0),
    ('空跑：exit 0、有输出但都不是断言',
     0, 'jsdom 24 已加载\n开始……\n完成\n', 'empty', 0, 0),
    ('崩在半路：跑了几条断言后抛异常（有 PASS、无 FAIL、exit≠0）',
     1, 'PASS  a\nPASS  b\nError: boom\n', 'crash', 2, 0),
]

for why, code, out, verdict, ep, ef in CASES:
    r = mp.classify_suite(code, out)
    check('classify_suite ▶ %s' % why,
          r['verdict'] == verdict and r['passed'] == ep and r['failed'] == ef
          and r['ok'] == (verdict == 'ok'))
    if r['verdict'] != verdict:
        print('        实际 %s（passed=%d failed=%d）' % (r['verdict'], r['passed'], r['failed']))

# 「空跑」必须判为**不通过** —— 这一条单独再钉一次，因为它是本轮修的假绿本体。
_empty_out = 'jsdom 24 已加载\n// 这一行里的 PASS 只是个词，不在行首\n完成\n'
r = mp.classify_suite(0, _empty_out)
check('classify_suite ▶ 零断言的套件不算通过（它就是假绿本体）', r['ok'] is False)
check('classify_suite ▶ 零断言 ⇔ verdict=empty（而不是 ok/fail）',
      r['verdict'] == 'empty' and r['passed'] == 0)

# 计数口径：只认行首的 PASS / FAIL。缩进的、行中的都不算。
r = mp.classify_suite(0, '  PASS 缩进的\nxFAIL 行中的\n')
check('classify_suite ▶ 只统计行首的 PASS/FAIL（缩进的行首不成对不算数）',
      r['passed'] == 0 and r['failed'] == 0 and r['verdict'] == 'empty')

# 每种结局都要有对应的显示标记，且标记不许重复（否则日志里分不出 crash / empty）
check('四种结局都有各自的标记，且互不重复',
      sorted(mp.VERDICT_MARK.keys()) == ['crash', 'empty', 'fail', 'ok']
      and len(set(mp.VERDICT_MARK.values())) == 4)

# 汇总字典的字段是下游（ci.py / build-info.json）在消费的，删掉会静默丢信息。
# 这里只能查字段名，所以顺带把更重要的一条也钉死：**run_tests 必须复用
# classify_suite**，不许自己再写一套判定 —— 同一件事的判据只许有一处。
_rt = inspect.getsource(mp.run_tests)
check('run_tests 的汇总字段齐全（ci.py / build-info.json 在消费）',
      all(k in _rt for k in ("'suites'", "'passed'", "'failed'", "'failedSuites'",
                             "'crashedSuites'", "'emptySuites'")))
check('run_tests 复用 classify_suite（不许在套件循环里再写一套判定）',
      'classify_suite(code, out)' in _rt)
check('classify_suite 是模块级纯函数（能被直接 import 断言，而不是内层闭包）',
      'def classify_suite(code, out):' in inspect.getsource(mp))
check('崩溃回显行数是模块级常量（可断言，而不是写死在函数体里）',
      isinstance(mp.CRASH_TAIL_LINES, int) and mp.CRASH_TAIL_LINES > 0)


# ================================================================ 2. HTML 内部引用
# options.html / popup.html 里 <script src> / <link href> 引用的本地文件也必须进包。
# 这条以前**完全没有**（manifest 只声明"有哪些页面"，页面内部引用它管不着），
# 漏了的表现和 rulecheck.js 那次一样：包缺文件、扩展加载即坏、门禁全绿。
SNIPPET = ('<link rel="stylesheet" href="options.css">'
           '<script src="site-templates.js"></script>'
           "<script src='expr.js'></script>"
           '<script src="https://cdn.example.com/x.js"></script>'
           '<img src="icons/icon16.png">'
           '<a href="native-host/install.py">安装</a>')
refs = mp.HTML_LOCAL_RE.findall(SNIPPET)
check('HTML 引用提取器能拿到 script/link/img 的 src/href（共 5 条）', len(refs) == 5)
check('HTML 引用提取器不看 <a href>（那不是"包内资源"）',
      all('native-host' not in r for r in refs))
check('HTML 引用提取器把外链也抓出来（由调用方按协议前缀过滤）',
      'https://cdn.example.com/x.js' in refs)

for page in mp.HTML_PAGES:
    p = os.path.join(HERE, page)
    if not os.path.exists(p):
        check('%s 存在（check_manifest 要扫它）' % page, False)
        continue
    found = mp.HTML_LOCAL_RE.findall(open(p, encoding='utf-8').read())
    check('%s 里有可校验的引用（>=1 条，否则这条守卫是空转的）' % page, len(found) >= 1)

# 用**真实现**跑一遍，而不是在这里重写一遍判据（同一件事的判据只许有一处）。
problems, _warnings = mp.check_manifest(mp.read_manifest())
bad_refs = [x for x in problems if '不在打包白名单里' in x]
check('当前 options.html / popup.html 的每个本地引用都进包（实实现校验）', not bad_refs)
for x in bad_refs:
    print('        ' + x)


# ================================================================ 3. git 跟踪校验
# 「本地绿、CI 红」的通类：CI 是全新 checkout，只有被跟踪的文件存在。
ok, probs, warns = mp.check_git_tracking()
check_git('本仓库当前所有门禁依赖的文件都已被 git 跟踪', ok)
for x in probs:
    print('        ' + x)

_saved = list(mp.GATE_SELF_FILES)
probe_ignored = 'sf-probe-tmp.zip'        # 命中 .gitignore 的 `*.zip`
probe_plain = 'zz-probe-tmp.js'           # 只是没 add

# workflow 是「门禁能在 CI 里生效的载体」：少跟踪一个 = 那条 workflow 在 GitHub 上
# **根本不存在**（仓库看着有 CI，其实只有一条），而本地毫无感觉。
wf = mp.workflow_files()
check('workflow_files() 扫到 .github/workflows/ 下的全部 yml（目录即事实来源）',
      len(wf) >= 2 and all(x.startswith('.github/workflows/') for x in wf))
for x in wf:
    print('        ' + x)

probe_wf_name = 'zz-probe-tmp.yml'
probe_wf = os.path.join(HERE, '.github', 'workflows', probe_wf_name)
try:
    with open(os.path.join(HERE, probe_ignored), 'w', encoding='utf-8') as f:
        f.write('// 临时探针\n')
    with open(os.path.join(HERE, probe_plain), 'w', encoding='utf-8') as f:
        f.write('// 临时探针\n')

    # .github/** 不在打包面里，只有 workflow_files() 能把它带进待查集合 ——
    # 所以这条探针真的在测「workflow 被纳入了 git 校验」，不是重复上面两条。
    with open(probe_wf, 'w', encoding='utf-8') as f:
        f.write('name: probe\n')
    ok_w, probs_w, _ = mp.check_git_tracking()
    check_git('git 校验 ▶ 新增的 workflow 也被纳入（忘了提交会在本地就红，不用等远端）',
              (not ok_w) and any(probe_wf_name in x for x in probs_w))

    mp.GATE_SELF_FILES = _saved + [probe_ignored]
    ok1, probs1, _ = mp.check_git_tracking()
    check_git('git 校验 ▶ 能抓到「被 .gitignore 吃掉」的文件',
              (not ok1) and any('被 .gitignore 忽略' in x for x in probs1))

    mp.GATE_SELF_FILES = _saved + [probe_plain]
    ok2, probs2, _ = mp.check_git_tracking()
    check_git('git 校验 ▶ 能抓到「忘了 git add」的文件',
              (not ok2) and any('还没纳入 git' in x for x in probs2))

    mp.GATE_SELF_FILES = _saved + ['no-such-file-tmp.js']
    ok3, probs3, _ = mp.check_git_tracking()
    check_git('git 校验 ▶ 门禁依赖的文件不存在时也报错（而不是静默跳过）',
              (not ok3) and any('不存在' in x for x in probs3))
finally:
    mp.GATE_SELF_FILES = _saved
    for f in (probe_ignored, probe_plain):
        p = os.path.join(HERE, f)
        if os.path.exists(p):
            os.unlink(p)
    if os.path.exists(probe_wf):
        os.unlink(probe_wf)

check('git 校验 ▶ 探针文件已清理（不留垃圾在仓库里，否则下次门禁会红）',
      not any(os.path.exists(os.path.join(HERE, f))
              for f in (probe_ignored, probe_plain))
      and not os.path.exists(probe_wf))

# 环境缺失时应当**放行 + 警告**：拿环境问题拦人只会逼出 --no-verify，把守卫废掉。
_real_run = mp.run
try:
    mp.run = lambda *a, **k: (128, 'fatal: not a git repository')
    ok_n, probs_n, warns_n = mp.check_git_tracking()
finally:
    mp.run = _real_run
check('git 校验 ▶ 没有 git / 不是仓库时放行 + 警告（环境缺失 ≠ 代码问题）',
      ok_n and not probs_n and len(warns_n) == 1)


# ================================================================ 4. 单一入口
# CI 和本地必须是同一个入口。两套命令一定会漂移，漂移的方向通常是
# 「CI 跑得比本地少」= 假绿。所以 ci.yml 里只许调用 ci.py。
ci_py = open(os.path.join(HERE, 'ci.py'), encoding='utf-8').read()
check('ci.py 提供 --install-hooks（pre-push 钩子的安装入口）',
      '--install-hooks' in ci_py and 'core.hooksPath' in ci_py)
check('ci.py 顶层吞异常时会留下完整调用栈并给独立退出码 3',
      'traceback.print_exc()' in ci_py and 'sys.exit(3)' in ci_py)
check('ci.py 调用 check_git_tracking（git 卫生是门禁的一步，不是可选项）',
      'check_git_tracking' in ci_py)

hook = os.path.join(HERE, '.githooks', 'pre-push')
check('pre-push 钩子文件存在', os.path.exists(hook))
if os.path.exists(hook):
    h = open(hook, encoding='utf-8').read()
    check('pre-push ▶ 跑的是同一个入口（python ci.py）', 'ci.py' in h)
    check('pre-push ▶ 支持 SKIP_CI_HOOK=1 手动跳过（否则会被 --no-verify 绕过）',
          'SKIP_CI_HOOK' in h)
    check('pre-push ▶ 环境缺失（退出码 2）时放行，不拦人',
          ('= "2"' in h or "= '2'" in h) and '环境' in h)
    check('pre-push ▶ 是 LF 行尾（CRLF 的钩子不报错、只是永远失效）',
          b'\r\n' not in open(hook, 'rb').read())

# 钩子必须带可执行位：不带的话 git **静默忽略**它（只在某些版本上给一行 hint），
# 于是"装了 pre-push"这件事看起来成功了、实际一次都没跑。
_code, out_m = mp.run(['git', 'ls-files', '-s', '.githooks/pre-push'], quiet=True)
mode = out_m.split()[0] if out_m.strip() else '(未纳入 git)'
check_git('pre-push 在 git 索引里带可执行位（100755）—— 否则 git 会静默忽略它',
          mode == '100755')
if mode != '100755':
    print('        当前索引模式：%s' % mode)

# 钩子/工作流的行尾由 .gitattributes 兜住（本地 core.autocrlf=true 会把它们变回 CRLF）
attr = os.path.join(HERE, '.gitattributes')
check('.gitattributes 存在，且为 .githooks/* 钉了 eol=lf', os.path.exists(attr))
if os.path.exists(attr):
    a = open(attr, encoding='utf-8').read()
    check('.gitattributes ▶ 有 .githooks/* 的 LF 规则（否则 checkout 后又变回 CRLF）',
          any('.githooks' in l and 'eol=lf' in l
              for l in a.splitlines() if not l.strip().startswith('#')))

# ================================================================ 5. 输出编码
# Windows 上 Python 的 stdout 编码**跟 locale 走**。GitHub Actions 的 windows-latest
# 是 en-US ⇒ cp1252 ⇒ 打印中文直接 UnicodeEncodeError。这不是假想：本轮 CI 就是
# 这么红的 —— 门禁挂在第一行 print 上，一套测试都没跑，而开发机是中文 Windows
# （cp936），永远复现不了。本地等价复现：`PYTHONIOENCODING=cp1252 python ci.py`。
# 所以下面每条都在**真的 cp1252 环境**里跑一次，不是查源码里有没有那几个词。
def _cp1252(args):
    return mp.run(args, env={'PYTHONIOENCODING': 'cp1252'})


code, out = _cp1252([sys.executable, '-c',
                     'import sys; sys.path.insert(0, %r); import make_package; '
                     'print("门禁 ✓ 磁力 → 已看")' % HERE])
check('cp1252 环境里 import make_package 后打印中文不崩（Windows runner 的坑）',
      code == 0 and 'UnicodeEncodeError' not in out)
if code != 0:
    print('        ' + out.strip().splitlines()[-1][:160])

# 子进程输出走管道时，编码同样跟 locale 走 ⇒ 从调用方（run）统一钉住，
# 新加的 Python 套件不必各自记得加守卫。
code, out = mp.run([sys.executable, '-c',
                    'import os; print(os.environ.get("PYTHONIOENCODING", ""))'])
check('run() 给子进程钉了 PYTHONIOENCODING=utf-8（否则子套件印中文会崩成"崩溃"）',
      out.strip() == 'utf-8')

# native-host 套件按设计不依赖仓库里任何模块，UTF-8 守卫是单独的一份 ——
# 按它真实的运行方式（直接跑文件）验一次。
code, out = _cp1252([sys.executable, os.path.join(HERE, '_test_native_host.py')])
check('_test_native_host.py 在 cp1252 环境里也能跑完（自带 UTF-8 守卫）',
      code == 0 and 'UnicodeEncodeError' not in out)
if code != 0:
    print('        ' + out.strip().splitlines()[-1][:160])

print('\n门禁自身（classify_suite / HTML 引用 / git 校验 / 单一入口 / 输出编码）测试全部通过 ✅'
      if _pass else '\n门禁自身测试存在失败 ❌')
sys.exit(0 if _pass else 1)
