# MM Paper Hub

一个可运行的多模态论文收集网页（真实 arXiv 数据源）。

## 运行

```bash
npm start
```

启动后访问：

<http://localhost:3000>

## 功能

- 实时检索 arXiv 论文（按关键词）
- 展示标题、作者、日期、摘要、PDF 链接
- 收藏 / 取消收藏
- 收藏持久化到本地文件 `data/favorites.json`

## 公网部署（Render）

1. 把项目推到 GitHub 仓库。
2. 打开 [Render](https://render.com/) 并登录。
3. New + -> Web Service -> 连接你的 GitHub 仓库。
4. Render 会自动识别 `render.yaml`，确认后点击 Deploy。
5. 部署完成后会得到公网地址（如 `https://mm-paper-hub.onrender.com`）。

## 注意

- 前端 API 地址在网页同域下自动工作，部署后无需改代码。
- `favorites.json` 是本地文件存储，免费平台重启后可能丢失收藏；要长期保存建议换 PostgreSQL。
