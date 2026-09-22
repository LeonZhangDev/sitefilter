# Requirements Index

需求文档索引。按编号升序排列。

| 编号 | 标题 | 状态 | 文档 |
| --- | --- | --- | --- |
| 001 | XChina Collector Integration | 已实施（前端集成已并入 main） | [001-xchina-collector-integration.md](001-xchina-collector-integration.md) |
| 002 | 屏蔽后的展示方式（三档）+ 番号站数量补足 | 已实施（L1 三档屏蔽、L2 番号补足均已落地） | [002-block-display-and-backfill.md](002-block-display-and-backfill.md) |
| 003 | 功能与扩展建议清单 | 建议稿（②④⑤ 已实施，其余待定） | [003-feature-suggestions.md](003-feature-suggestions.md) |
| 004 | 番号站翻页 + 磁力站可行性验证报告 | 验证完成（只读报告；新站真实页面验证仍未做） | [004-pagination-and-magnet-site-verification.md](004-pagination-and-magnet-site-verification.md) |

## 说明

- **002 分两层**：L1「保位」= 屏蔽后保留网格占位（三档下拉，默认「保留占位」）；
  L2「补足」= 从下一页预取克隆补齐卡片数，**仅在番号站尝试**，且是全库唯一会发网络请求的开关
  （默认关闭，白名单 `JavDB580`）。详见 [002](002-block-display-and-backfill.md)。
- **003 是建议稿**，其中 ②多站比价 / ④影响面预演 / ⑤备份快照多份+分项回滚 已实施；
  ⑦⑧⑨ 等条目为「慎重/不建议」，未列入排期。
- **004 是只读验证报告**，结论：番号站补足只剩 `JavDB580` 一个站可行；
  三项新站（PornHub / YouPorn / 西斯寂舍）的真实页面验证仍未进行。
