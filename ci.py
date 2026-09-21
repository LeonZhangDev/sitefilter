# -*- coding: utf-8 -*-
"""
SiteFilter 一键门禁（CI gateway）。

用法：
    python ci.py                # 语法检查 + 全部测试 + 打包校验（不产出版本变更）
    python ci.py --release patch  # 门禁通过后自增版本号并产出发布包

它和 CI 里跑的是同一套逻辑，全部集中在 make_package.py；
ci.py 只负责编排 + 汇总输出，避免两处实现慢慢走偏。

退出码：0 = 全绿；非 0 = 有阻塞项（CI 会因此变红）。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_package as mp   # noqa: E402


def main():
    argv = sys.argv[1:]
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

    # ---- 1. 环境 ----
    node = mp.find_node()
    print('\n[1/4] 环境')
    if not node:
        print('  ❌ 找不到 node（可设环境变量 NODE=<路径>）')
        return 2
    print('  node : %s' % node)
    print('  python: %s' % sys.version.split()[0])
    print('  NODE_PATH: %s' % (mp.node_path_env() or '(空)'))

    # ---- 2. 语法 ----
    print('\n[2/4] JS 语法检查')
    ok, bad = mp.syntax_check()
    if not ok:
        for b in bad:
            print('  ❌ %s' % b)
        print('\n门禁失败：语法检查未通过。')
        return 1
    print('  全部通过')

    # ---- 3. 测试 ----
    print('\n[3/4] 测试套件')
    ok, _d, summary = mp.run_tests()
    if not ok:
        print('\n门禁失败：以下套件有失败用例 → %s' % ', '.join(summary.get('failedSuites', [])))
        return 1
    print('\n  合计 %d 套 / %d 项断言通过，0 失败'
          % (summary.get('suites', 0), summary.get('passed', 0)))

    # ---- 4. 打包 ----
    print('\n[4/4] 打包校验')
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
    sys.exit(main())
