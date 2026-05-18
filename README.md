# 微信公众号排版小助手

一个用于公众号文章排版、AI 配图、并推送到微信草稿箱的 Web 工具。

## 主要功能

- Markdown 编辑与公众号样式实时预览
- 复制预览内容
- 普通文章草稿推送到微信公众号草稿箱
- 贴图草稿 `newspic` 推送，最多 20 张图片
- 音频上传为微信永久语音素材，并返回可复制的 `media_id`
- 访问密码登录，未登录无法看到编辑器或调用接口
- AI 生成封面图和正文插图
- `![](ai://提示词)` 正文插图占位，推送时自动生成并上传到微信
- 文字草稿自动保存到本地浏览器
- 推送前检查凭据、标题、封面、插图数量、音频格式和文件大小

## 本地运行

**前置要求：** Node.js 20+

```bash
npm install
cp .env.example .env.local
npm run dev
```

访问 <http://localhost:3000>。

AI 生图需要在 `.env.local` 中配置：

```bash
SILICONFLOW_API_KEY="你的硅基流动 API Key"
APP_PASSWORD="你的访问密码"
AUTH_SECRET="一段随机长字符串"
```

## 部署

仓库包含 `render.yaml`，可通过 Render Blueprint 部署。生产环境需要配置：

- `SILICONFLOW_API_KEY`
- `APP_PASSWORD`
- `AUTH_SECRET`
- `IMAGE_MODEL`，默认 `black-forest-labs/FLUX.1-dev`

微信接口还要求把部署服务的出口 IP 加入微信公众号后台 IP 白名单。

## 访问控制

登录密码必须在部署平台的环境变量里配置，不能写进代码仓库。部署者设置一次 `APP_PASSWORD` 后，把网站地址和这个访问密码发给授权使用者即可。

如果别人 fork 或部署自己的版本，他们需要在自己的 Render 服务里设置自己的 `APP_PASSWORD` 和 `AUTH_SECRET`。
