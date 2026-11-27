---
layout: ../layouts/Guide.astro
title: 桌面 Reader 与浏览器扩展隐私说明
description: 首发桌面应用与配套浏览器扩展的数据去向、权限和用户控制。
---

更新日期：2026 年 11 月 27 日。本页说明桌面 Reader 与配套扩展的数据使用；可用版本及更新方式以下载页和对应版本说明为准。

本页下方提供英文说明（English version below）。

## 本机阅读

桌面 Reader 默认免登录。导入资料、标注、生词、复习记录和配置保存在本机资料目录。
联网抓取网页会访问来源网站；在线词典、语音及 AI 功能会访问用户选择的服务。
AI 数据共享需另行确认，普通阅读不要求启用 AI。远程服务的运营者负责其存储和保留政策。

## 浏览器剪藏

扩展仅在用户主动激活当前页面后读取该页网址和内容，并与所选 Reader 交换剪藏和标注。
它默认只连接本机，不自动向在线 Reader 发送网页，也不持续收集所有浏览历史。
上传前会剔除表单控件、应用脚本状态、隐藏元素及常见敏感属性；这不能保证正文不含个人或保密信息。
请只剪藏你愿意交给所选 Reader 的内容，包括登录后可见的文章。

在扩展设置中保存远程 HTTPS 地址，会明确启用向该服务器发送网页、网址、高亮和笔记。
浏览器会请求该地址的访问权限及 Reader 会话读取权限；会话仅用于向该 Reader 认证。
首发不提供 YouTube、Bilibili 等视频站点的 Cookie 导出。相关视频导入可在 Reader 中按能力另行操作。

扩展设置可随用户启用的 Chrome 同步功能同步；待保存的少量标注草稿留在扩展本地存储中。
诊断摘要仅在本地短期保留，分享前可预览，不自动上传。卸载扩展会清除其本地数据，
但不会删除已保存到 Reader 的文章；请在对应 Reader 中管理或删除资料。

## 浏览器数据的限制使用

扩展通过浏览器 API 访问的信息仅用于向用户选择的 Reader 保存网页、网址、标注及笔记，
以及完成这项用途所必需的连接、认证和故障处理。我们遵守 Chrome Web Store 用户数据政策及其
限制使用要求，不出售这些信息，不将其用于广告、信用评估或与剪藏和批注无关的用途。
扩展不会因为获得权限就自动读取全部浏览历史或向维护者发送资料库内容。
用户选择的远程 Reader 会收到上述内容；它的运营者负责该服务的数据保留、访问及删除政策。

## 可选功能与控制

如主动使用 myON 导出，扩展会另行请求相应站点权限并向用户选择的 Reader 导入资料。
这不授予内容的再分发权。麦克风仅用于主动开始的录音，退出录音界面会释放采集资源。
语音识别匹配诊断是实验功能，不是音素级发音质量测评。

桌面 0.26.0 不执行后台更新检查。启用在线更新的桌面版本会在启动后及运行期间检查更新。
更新组件会在本机保留随机分批更新标识（`.updaterId`），检查时通过 `x-user-staging-id` 请求头发送给
GitHub 及其内容分发服务；这些服务也会接收 IP 地址和常规连接信息。更新请求不上传书库、笔记、正文或账号凭据。

macOS、Windows 安装版和 AppImage 的下载与重启安装分别需要确认，普通退出不会顺便安装更新。
DEB 下载需确认，验证后由用户另行打开系统安装器处理权限和安装；Portable 继续手动更新。

可在浏览器扩展管理中撤销站点权限、停用或卸载扩展，也可修改 Reader 目标地址。
撤销权限会阻止后续访问，不会收回已经发送的数据。涉及远程服务的数据访问、删除或保留问题，
请联系你所选服务的运营者。产品安全问题可通过
[GitHub 私密漏洞报告](https://github.com/lwtlab/reader/security/advisories/new) 联系维护者。

## English privacy notice

Updated 27 November 2026. This notice covers Reader desktop and its companion extension.
Available versions and update methods are described on the download page and in each release.

Reader desktop uses a local library without requiring a login. Imported documents,
annotations, vocabulary, review records and settings are stored on your computer.
Fetching a URL contacts its source website. Optional dictionaries, speech and AI
features contact the services you choose. AI content sharing requires separate
confirmation; ordinary reading does not require AI.

Reader Clipper reads the current page's URL and content when you activate it to
save or annotate that page. It defaults to local Reader and does not continuously
collect all browsing history. Before uploading a snapshot it removes form controls,
application scripts, hidden elements and common sensitive attributes. Visible prose,
including a page you opened while signed in, can still contain private information.
Only clip material you intend to share with the selected Reader.

Saving an optional remote HTTPS destination explicitly enables sending clipped
pages, URLs, highlights and notes to that server. The extension requests access to
that origin and optional cookie access to authenticate with that Reader's session.
This candidate does not export video-site cookies. Optional myON import separately
requests access to its supported sites and imports material into your selected
Reader; using it does not grant redistribution rights.

Browser API data is used only to save and annotate content in the Reader you choose,
and for the connection, authentication and troubleshooting necessary for that purpose.
We follow the Chrome Web Store User Data Policy and its Limited Use requirements.
We do not sell this information or use it for advertising, credit decisions or
unrelated purposes. Granting a permission does not start automatic collection of all
browsing history or transmission of your library to the maintainer. A remote Reader
operator is responsible for that service's retention, access and deletion policies.

Extension settings may use Chrome sync if you enable it. Pending annotation drafts
remain in local extension storage. Short-lived startup diagnostics stay local and
can be previewed before you choose to share them. Uninstalling the extension removes
its local data; it does not delete articles already saved in Reader. Manage or delete
those articles in the Reader that received them. Revoking a permission prevents
future access and does not recall information already sent.

Microphone capture starts only when you choose to record and is released on leaving
the recording interface. Recognition-match diagnostics are experimental and do not
measure phoneme-level pronunciation quality.

Desktop 0.26.0 does not perform background update checks. Update-enabled desktop builds
check after startup and while running. The update component retains a random staging
identifier locally in `.updaterId` and sends it in the `x-user-staging-id` request header
when checking for updates. GitHub and its content delivery services also receive your
IP address and ordinary connection information. Update requests do not upload your
library, notes, document text or account credentials.

On macOS, Windows installers and AppImage, downloading and restarting to install
require separate confirmation; ordinary quitting does not install an update. DEB
downloads require confirmation and source verification, after which you separately
open the system installer to handle permissions and installation. Portable builds
continue to require manual updates.

You can change the destination, revoke site permissions, disable or uninstall the
extension in Chrome. For remote-library access, deletion or retention, contact the
operator you selected. Report product security issues through the
[private vulnerability reporting form](https://github.com/lwtlab/reader/security/advisories/new).
