---
layout: ../../layouts/Guide.astro
title: 使用浏览器扩展
description: 把正在浏览的文章带回 Reader，继续阅读与学习。
---

## 扩展可以做什么

Reader 浏览器扩展用于保存当前页面、剪藏文章，以及在支持的页面上创建高亮和笔记。它适合需要浏览器登录状态、直接粘贴 URL 不易提取的文章。

## 当前安装入口

Reader Clipper **0.26.0** 已发布手动安装 ZIP，配套 Reader 桌面版 **0.26.0**。目前未在 Chrome Web Store 上架；ZIP 下载与商店安装是独立入口，手动安装版不通过商店自动更新。

1. 从教程导航中的“下载与安装”或[官方版本页面](https://github.com/lwtlab/reader/releases/tag/extension/v0.26.0)下载 [reader-clipper-v0.26.0.zip](https://github.com/lwtlab/reader/releases/download/extension/v0.26.0/reader-clipper-v0.26.0.zip)。
2. 核对版本和 [SHA256SUMS 校验文件](https://github.com/lwtlab/reader/releases/download/extension/v0.26.0/SHA256SUMS)，确认来源为 `lwtlab/reader` 的官方 Release。
3. 解压到准备长期保留的目录，例如 `Reader-Clipper`。安装后不要删除或移动该目录，浏览器会持续从这里加载文件。
4. 在 Chrome 地址栏打开 `chrome://extensions/`，开启“开发者模式”，选择“加载已解压的扩展程序”，再选择包含 `manifest.json` 的目录。
5. 确认扩展列表显示 Reader Clipper 0.26.0，再按下节连接 Reader。

## 手动更新扩展

下载新版本后先核对对应的桌面版本和摘要，再解压，用新版本文件替换原固定目录中的文件。在 `chrome://extensions/` 的 Reader Clipper 卡片上点击“重新加载”。继续使用同一目录，避免每次更新重复添加一份扩展。

手动安装版不会自动获取新版；请从官方版本页面或下载页查看更新。以后如提供 Chrome Web Store 入口，请从官网下载页进入正式商店页面，不把 ZIP 当作商店包安装。

## 连接 Reader

扩展默认连接本机桌面 Reader，无需登录。请先启动 Reader；若找不到，或同时运行了多个资料库，
在 Reader 的“文件 → 复制 Reader 地址”中获取地址，粘贴到扩展设置后保存。
手动指定的地址不会自动切换到其他 Reader。

远程 HTTPS 服务是可选项，需在扩展设置中保存并授予相应权限。启用后，剪藏的网页、网址与标注会发送到该服务，
并使用浏览器中的 Reader 登录会话认证。请先阅读页脚链接中的“隐私说明”。首发不提供视频站点 Cookie 导出。

## 保存后回到书库

打开 Reader 书库确认文章和正文，再进行查词、笔记与复习。网站权限、登录状态和页面结构会影响剪藏结果；失败时可回到粘贴文本导入。
