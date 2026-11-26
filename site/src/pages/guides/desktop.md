---
layout: ../../layouts/Guide.astro
title: 桌面安装与更新
description: 选择适合电脑的安装包，核验来源与版本，保留自己的书库继续阅读。
---

## 安装前先确认

正式下载入口与可用版本以下载页为准。对应平台仍显示“尚未公开发布”时，请先使用网页版，
不要从第三方网盘或同名站点获取安装包。教程中的文件名只是示例，签名和系统兼容范围以该版本说明为准。

核心桌面包用于本机阅读、词汇、笔记与复习，无需 Reader 账号即可打开本机书库。
AI、联网词典和语音取决于相应服务、工具与模型；缺少资源时会给出提示，不能据此认为模型已随包提供。
PDF 的显示与提取仍可能受文件结构影响。浏览器扩展需单独安装，并配对到你选择的 Reader。

<h2 id="macos">macOS：选择处理器版本</h2>

在“关于本机”查看芯片：Apple M 系列选择 Apple Silicon / arm64；Intel 处理器选择 Intel / x64。

1. 下载对应版本的 DMG，打开后将 Reader 拖到“应用程序”。
2. 从“应用程序”打开 Reader，按系统正常的首次打开提示操作。
3. 如果 macOS 提示无法验证、已损坏或签名不正确，先停止打开，重新核对下载来源与该版本说明。
   请勿用移除 quarantine、关闭 Gatekeeper 等方式绕过检查。

ZIP 是另一种分发格式，下载后解压并将 Reader.app 放到“应用程序”；它与 DMG 使用相同的本机资料目录。
不要直接在磁盘映像或解压工具内部长期运行应用。

<h2 id="windows">Windows：安装版与 Portable</h2>

x64 安装版文件名以 `-setup.exe` 结尾，按安装向导完成后从开始菜单打开。
Portable 文件名以 `-portable.exe` 结尾，适合无需安装的启动方式；它仍使用本机用户的资料目录，
不会自动把书库放进 EXE 或让书库随文件移动。

首次运行请核对发布者和版本说明。即使文件有签名，系统也可能按信誉显示提示；如果发布者、文件摘要或来源不符，
先停止运行并重新下载。请勿关闭 Defender、SmartScreen 或以管理员身份反复尝试启动。

<h2 id="linux">Linux：DEB 与 AppImage</h2>

正式版本和文件名以下载页为准。下面的 0.26.0 文件名是命令示例，请替换成实际下载的版本。

Ubuntu / Debian 用户可选择 DEB，按系统软件安装器的提示安装后，从应用菜单启动 Reader。
DEB 的正常启动保留 Chromium 沙箱；AppImage 不需要先安装 DEB。

使用 AppImage 时，在下载目录打开终端，先赋予运行权限，再正常启动：

```bash
chmod u+x Reader-0.26.0-linux-x64-core.AppImage
./Reader-0.26.0-linux-x64-core.AppImage
```

如果 Ubuntu 24.04 等系统提示 sandbox helper 或用户命名空间权限错误，可选择 DEB；
也可在了解以下风险后，主动使用兼容启动：

**安全提示：`--no-sandbox` 会关闭 Chromium 的进程沙箱，包括渲染和工具进程的操作系统隔离。
一旦恶意内容利用渲染器漏洞，攻击者更容易以当前用户权限访问本机文件和其他资源。
处理网页、电子书或 PDF 时也存在这一风险；只打开信任的内容不能消除它。**
Reader 不会自动添加此参数。希望保留这层保护的用户应选择 DEB 的正常启动方式。

```bash
./Reader-0.26.0-linux-x64-core.AppImage --no-sandbox
```

兼容启动不需要 `sudo`、FUSE2 或修改系统 AppArmor/sysctl 设置。每次以此方式启动都需主动传入参数；
不要以 root 身份运行 Reader。退出后，下次不带参数启动会重新尝试正常沙箱启动。
文件名随版本变化时，请使用实际下载的文件名。

此方式参考 [Obsidian 的 AppImage 安装说明](https://obsidian.md/help/install)。
[Electron 官方沙箱文档](https://www.electronjs.org/docs/latest/tutorial/sandbox)建议仅在测试中使用该参数，
不建议用于生产环境；提供兼容命令不表示它与正常沙箱启动具有相同的安全性。

<h2 id="checksums">核对安装包</h2>

从同一正式版本下载 `SHA256SUMS`，比较文件名和完整 SHA-256。可在下载目录使用：

```bash
# macOS：将文件名替换成实际下载的文件
shasum -a 256 Reader-0.26.0-mac-arm64-core.dmg

# Linux
sha256sum Reader-0.26.0-linux-x64-core.AppImage
```

Windows PowerShell 示例：

```powershell
Get-FileHash .\Reader-0.26.0-win-x64-core-setup.exe -Algorithm SHA256
```

摘要必须与正式版本的记录完全一致。SHA-256 用于核对文件字节，不能代替发布者签名或确认来源可信。
不一致时不要运行，重新从正式入口下载并核对。

<h2 id="updates">手动更新与资料保留</h2>

本次桌面首发采用手动更新。Reader 不会自动下载并安装更新；请从下载页打开新版本说明。

1. 先查看新版本的兼容、迁移与备份说明，完全退出正在运行的 Reader。
2. 找到并备份整个 Reader 资料目录；其中可能含文章、数据库、笔记和个人设置，
   请只保存到自己信任的位置。不要仅备份安装包，也不要把真实书库作为问题附件公开。
3. 核验新安装包的摘要与发布者，再按同一种方式覆盖安装或替换应用文件。
4. 打开原书库，确认文章、笔记、词汇和阅读位置。Portable / AppImage 换位置不等于移动书库。

默认资料目录如下；如果使用了自定义资料目录，请备份实际位置：

- macOS：`~/Library/Application Support/reader/`
- Windows：`%APPDATA%\reader\`
- Linux：`~/.config/reader/`，或用户配置目录中的 `reader/`。

普通卸载不应自动删除书库；手动删除资料目录会删除其中的个人数据。
新版本可能迁移数据库，降级前请按对应版本说明恢复兼容备份，不要直接让旧程序打开已经迁移的原资料。

## 遇到问题

先记录 Reader 版本、系统版本、处理器与安装格式，以及可复现的步骤。
可以从官网页脚进入 GitHub 反馈普通问题；不要在公开问题里粘贴密钥、Cookie、完整日志、私人文章或资料目录。
如需分享诊断或内容，请先在 Reader 中预览范围、删去敏感信息，再决定是否提交。
安全问题请使用正式发布时提供的私密安全联系渠道，避免公开漏洞细节或凭据。
