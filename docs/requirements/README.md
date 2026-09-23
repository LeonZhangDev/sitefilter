# Requirements Index

需求文档索引。按编号升序排列。

| 编号 | 标题 | 状态 | 文档 |
| --- | --- | --- | --- |
| 001 | XChina Collector Integration | 已实施（前端集成已并入 main） | [001-xchina-collector-integration.md](001-xchina-collector-integration.md) |
| 002 | 屏蔽后的展示方式（三档）+ 番号站数量补足 | **已实施**（L1 三档屏蔽；L2 补足仅 `JavDB580` 且默认关闭） | [002-block-display-and-backfill.md](002-block-display-and-backfill.md) |
| 003 | 功能与扩展建议清单 | **已全部收口**（①–⑩ 均有结论；第五节拆 `content.js` 已完成 —— 见文首「实施状态」） | [003-feature-suggestions.md](003-feature-suggestions.md) |
| 004 | 番号站翻页 + 磁力站可行性验证报告 | 验证完成，**报告里的修复建议已全部落地**（三站选择器 + 兜底防导航污染 —— 见文首「落地状态」） | [004-pagination-and-magnet-site-verification.md](004-pagination-and-magnet-site-verification.md) |

## 说明

- **002 分两层**：L1「保位」= 屏蔽后保留网格占位（三档下拉，默认「保留占位」）；
  L2「补足」= 从下一页预取克隆补齐卡片数，**仅在番号站尝试**，且是全库唯一会发网络请求的开关
  （默认关闭，白名单 `JavDB580`）。详见 [002](002-block-display-and-backfill.md)。
- **003 是建议稿，现已全部收口**：①②③④⑤⑥⑧ 已实施，⑦ 按 ② 的方式降级落地（只做比价，
  不做自动找最优源），⑨⑩ 判定不做；第五节的「拆 `content.js`」也已完成
  （`magnet-core.js` + `site-templates.js`，三端共用）。
- **004 是只读验证报告**，两条结论都已生效：番号站补足只剩 `JavDB580` 一个站可行（放行名单
  只有这一处 `bf: true`）；三项新站（PornHub / YouPorn / 西斯寂舍）的验证发现已全部修掉
  （`ad80ef1` 修 YouPorn / 西斯寂舍的 `tpl`、并给论坛兜底加了防「认成导航菜单」的容器约束）。
