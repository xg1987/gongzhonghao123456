# 部署指南（Render 免费版 + 硅基流动生图）

> 更新：默认生图模型为 **FLUX.1 dev**（顶级画质）。正文支持最多 3 张 AI 插图占位 `![](ai://提示词)`，推送时自动生成并上传到微信。现已支持用户注册登录和音频永久语音素材上传。

## 一、本次更新了什么

1. 新增 `render.yaml` —— Render Blueprint 一键部署配置
2. `server.ts` 新增 `POST /api/generate-image` —— 调用硅基流动生图，自动下载并返回 base64
3. 前端"推送到草稿箱"弹窗里新增紫色"AI 生成封面"面板，生成的图会自动填入封面位
4. `start` 脚本改用 `tsx`，`tsx` 从 devDeps 移到 deps（Render 生产环境能直跑 TS）
5. `PORT` 从环境变量读取（Render 会自动注入）
6. 新增本地草稿自动保存和推送前检查，提前提示缺少凭据、封面过大、插图超限等问题
7. 新增音频素材上传：支持 MP3/AMR，上传成功后返回 `media_id`
8. 新增用户注册登录：未登录时只显示登录/注册页，业务 API 需要登录 Cookie

---

## 二、部署步骤（首次约 10 分钟）

### Step 1：注册硅基流动拿 API Key

1. 打开 <https://cloud.siliconflow.cn/>
2. 用手机号注册（新用户送 14 元额度，够生几千张图）
3. 左侧菜单 → 「API 密钥」→ 新建 API Key → 复制备用（以 `sk-` 开头）

### Step 2：在 Render 部署

1. 打开 <https://render.com/> → 用 GitHub 登录
2. 授权 Render 访问你的 `gongzhonghao123456` 仓库（首次会弹 OAuth 授权）
3. 右上角 **New +** → **Blueprint**
4. 选择仓库 `xg1987/gongzhonghao123456`，分支选 `main`
5. Render 会自动读取 `render.yaml`，点 **Apply**
6. 在 **Environment** 标签页配置：
   - `SILICONFLOW_API_KEY`：刚才的硅基流动 API Key
   - `AUTH_SECRET`：登录 Cookie 签名密钥，建议用随机长字符串
   - `REGISTRATION_CODE`：可选注册码；配置后新用户注册必须填写
   - `USER_STORE_PATH`：用户文件路径，默认 `./data/users.json`
7. 等 3~5 分钟构建完成。域名形如 `https://gongzhonghao-wechat-xxxx.onrender.com`

### Step 3：把 Render 出口 IP 加入微信白名单

这一步**必须做**，不然调微信 API 会报"IP 未在白名单"。

1. 在 Render Dashboard → 你的服务 → **Connect** 标签 → 看 **Outbound IPs**，会给你 2~3 个 IP
2. 打开微信公众平台 → 设置与开发 → 基本配置 → **IP 白名单** → 把这些 IP 全部加进去
3. 保存

> ⚠️ Render 的出口 IP 偶尔会增加，如果后面某天推送失败报"IP 未在白名单"，回来看看是否多了新 IP。

### Step 4：试用

1. 打开 Render 给你的域名
2. 首次使用点击「注册」，输入昵称、邮箱、密码；如果配置了 `REGISTRATION_CODE`，还需要输入注册码
3. 点右上角 **设置** → 输入你的公众号 AppID / AppSecret → 保存
4. 编辑 Markdown → 点 **推送/上传** → 填标题
5. 想用 AI 生图：在紫色面板填描述（或留空用标题自动生成）→ 点"生成封面图" → 等 15~30 秒；AI 封面会按横版比例生成
6. 点"确认推送" → 去公众号后台草稿箱看
7. 如需上传音频，草稿类型选择「音频素材」，选择 MP3/AMR 后点"确认上传"，复制返回的 `media_id`

---

## 三、免费版注意事项

| 项 | 说明 |
|---|---|
| Render 免费版会休眠 | 15 分钟无请求后休眠，冷启动 ~30 秒。前端已处理过冷启动提示。 |
| Render 免费 750h/月 | 单个服务一直跑也够用（720h/月）。 |
| 硅基流动免费额度 | 14 元新用户额度；Kolors 模型生成 1 张约 0.001~0.01 元，个人用几乎用不完。 |
| 微信 IP 白名单 | Render 出口 IP 增加时需手动补。 |

---

## 四、本地开发

```bash
git clone https://github.com/xg1987/gongzhonghao123456.git
cd gongzhonghao123456
cp .env.example .env.local
# 编辑 .env.local 填 SILICONFLOW_API_KEY
npm install
npm run dev
# 访问 http://localhost:3000
```

---

## 五、常见问题

**Q：推送草稿报 "IP 未在白名单"？**
A：回 Render Connect 标签，复制所有 Outbound IP 到微信白名单。

**Q：AI 生成按钮点了没反应 / 报 "未配置 SILICONFLOW_API_KEY"？**
A：去 Render Dashboard → 服务 → Environment → 检查 `SILICONFLOW_API_KEY` 是否填了值，改完要 **Manual Deploy** 一次才能生效。

**Q：登录页提示服务器未配置 APP_PASSWORD？**
A：新版本已经不使用共享 `APP_PASSWORD`。如果仍看到这个提示，说明线上还没有部署到最新版本，请等待 Render 自动部署完成或手动重新部署。

**Q：其他人怎么使用？**
A：部署者把线上网址发给授权使用者。使用者自己注册账号后登录。如果配置了 `REGISTRATION_CODE`，需要同时把注册码发给授权使用者。

**Q：用户数据保存在哪里？**
A：默认保存在服务端 `./data/users.json`。生产环境建议把 `USER_STORE_PATH` 指向持久化磁盘路径，或者后续升级为数据库；否则部分平台重新部署后可能丢失本地文件。

**Q：注册码一定要配置吗？**
A：不是必须。如果不配置，任何能访问网站的人都可以注册。为了避免陌生人注册，建议生产环境配置 `REGISTRATION_CODE`。

**Q：生图太慢 / 想换模型？**
A：默认模型是 `black-forest-labs/FLUX.1-dev`（画质更好）。想更快可以在前端「设置」里切到 `black-forest-labs/FLUX.1-schnell`；想更适合中文语义可以切到 `Kwai-Kolors/Kolors`。

**Q：封面图太大被微信拒？**
A：微信封面要求 < 2MB、建议 900x383。新版本会在推送前检查封面大小和比例，超过 2MB 会阻止推送并提示处理。

**Q：音频为什么不是草稿？**
A：微信草稿箱接口主要支持图文文章和贴图结构；音频通过永久素材接口上传为 `voice` 素材。上传成功后拿到的 `media_id` 可用于自动回复、客服消息或后续接口调用。
