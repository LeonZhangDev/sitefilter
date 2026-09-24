# -*- coding: utf-8 -*-
"""
SiteFilter 一键门禁（CI gateway）。

用法：
    python ci.py                # git 卫生 + 语法检查 + 全部测试 + 打包校验（不产出版本变更）
    python ci.py --release patch  # 门禁通过后自增版本号并产出发布包
    python ci.py --install-hooks  # 安装 pre-push 钩子（本地配置，每台机器跑一次）

它和 CI 里跑的是同一套逻辑，全部集中在 make_package.py；
ci.py 只负责编排 + 汇总输出，避免两处实现慢慢走偏。
`.github/workflows/ci.yml` 必须调用本文件（不许自己拼测试命令）——
两套命令一定会漂移，而漂移的方向通常是「CI 跑得比本地少」，也就是假绿；
`_test_assembly.js` 盯着这一点。

退出码：0 = 全绿；1 = 有阻塞项（CI 会因此变红）；2 = 环境缺失（找不到 node）；3 = 门禁自身崩了。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_package as mp   # noqa: E402


def install_hooks():
    """把 .githooks 设成 hooksPath —— 让 pre-push 在本地先跑一遍门禁。

    这是唯一能**从源头**消灭「推到远端才发现红」的东西：CI 能告诉你的，pre-push
    能在你按下回车之前告诉你。它是本地配置、不进仓库，所以换机器后要再跑一次。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    hook = os.path.join(here, '.githooks', 'pre-push')
    if not os.path.exists(hook):
        print('❌ 找不到 .githooks/pre-push —— 这个仓库缺了它，无法安装。')
        return 1
    code, out = mp.run(['git', 'config', 'core.hooksPath', '.githooks'], quiet=True)
    if code != 0:
        print('❌ 设置 core.hooksPath 失败：%s' % out.strip())
        return 1
    code2, out2 = mp.run(['git', 'config', 'core.hooksPath'], quiet=True)
    print('✅ 已安装 pre-push 钩子：core.hooksPath = %s' % (out2.strip() or '.githooks'))
    print('   之后每次 git push 会先跑一遍 `python ci.py`；')
    print('   想跳过：SKIP_CI_HOOK=1 git push（找不到 python/node 时只警告、不拦截）。')
    print('   注意：这是本地配置、不进仓库 —— 换机器后在本仓库根目录再跑一次本命令。')
    return 0


def main():
    argv = sys.argv[1:]
    if '--install-hooks' in argv:
        return install_hooks()
    release = None
    if '--release' in argv:
        i = argv.index('--release')
        release = argv[i + 1] if i + 1 < len(argv) else 'patch'
    out = None
    if '--out' in argv:
        i = argv.index('--out')
        out = argv[i + 1] if i + 1 < len(argv) else None

    t0 = time.time()
    print('=' * 62)
    print('SiteFilter CI 门禁')
    print('=' * 62)

    # ---- 0. git 卫生 ----
    # 放在最前面，因为它拦的是"本地全绿、CI 红"这一类 —— 后面的每一步都可能
    # 因为一个没被 git 跟踪的文件而在 CI 上以完全不同的方式失败。
    print('\n[0/5] git 卫生（门禁依赖的文件是否都在 git 里）')
    ok, probs, warns = mp.check_git_tracking()
    for w in warns:
        print('  ⚠️  %s' % w)
    if not ok:
        for p in probs:
            print('  ❌ %s' % p)
        print('\n门禁失败：有门禁依赖的文件没纳入 git —— 本地全绿，但 CI 的 checkout 里没有它。')
        return 1
    if not warns:
        print('  门禁依赖的文件都在 git 里')

    # ---- 1. 环境 ----
    node = mp.find_node()
    print('\n[1/5] 环境')
    if not node:
        print('  ❌ 找不到 node（可设环境变量 NODE=<路径>）')
        return 2
    print('  node : %s' % node)
    print('  python: %s' % sys.version.split()[0])
    print('  NODE_PATH: %s' % (mp.node_path_env() or '(空)'))

    # ---- 2. 语法 ----
    print('\n[2/5] JS 语法检查')
    ok, bad = mp.syntax_check()
    if not ok:
        for b in bad:
            print('  ❌ %s' % b)
        print('\n门禁失败：语法检查未通过。')
        return 1
    print('  全部通过')

    # ---- 3. 测试 ----
    print('\n[3/5] 测试套件')
    ok, _d, summary = mp.run_tests()
    if not ok:
        print('\n门禁失败：以下套件有失败用例 → %s' % ', '.join(summary.get('failedSuites', [])))
        return 1
    print('\n  合计 %d 套 / %d 项断言通过，0 失败'
          % (summary.get('suites', 0), summary.get('passed', 0)))

    # ---- 4. 打包 ----
    print('\n[4/5] 打包校验')
    if release:
        print('  发布模式：版本号自增（%s）' % release)
    try:
        mp.build(out=out, ci=False, bump=release,
                 note='CI 一键发布' if release else '', unpacked=True,
                 test_summary=summary)
    except SystemExit as e:
        print('\n门禁失败：打包校验未通过。')
        return 1

    print('\n' + '=' * 62)
    print('✅ 门禁全绿（耗时 %.1fs）—— 可以提交 / 发布' % (time.time() - t0))
    print('=' * 62)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise                      # 打包/校验里 sys.exit(消息) 的退出码要原样保留
    except Exception:
        # 门禁自己崩了也要留下完整调用栈：CI 日志里只有 traceback 才能定位，
        # 而本地用管道看输出时（tail/grep）traceback 常被截掉，只剩一句"exit 1"。
        import traceback
        traceback.print_exc()
        print('\n门禁失败：ci.py 自己抛异常了（不是测试失败）—— 上面是完整调用栈。')
        sys.exit(3)
