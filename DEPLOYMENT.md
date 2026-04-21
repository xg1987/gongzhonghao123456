# 部署指南（Render 免费版 + 硅基流动生图）

## 一、本次更新了什么

1. 新增 `render.yaml` —— Render Blueprint 一键部署配置
2. `server.ts` 新增 `POST /api/generate-image` —— 调用硅基流动生图，自动下载并返回 base64
3. 前端"推送到草稿箱"弹窗里新增紫色"AI 生成封面"面板，生成的图会自动填入封面位
4. `start` 脚本改用 `tsx`，`tsx` 从 devDeps 移到 deps（Render 生产环境能直跑 TS）
5. `PORT` 从环境变量读取（Render 会自动注入）

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
6. 在 **Environment** 标签页 → 把刚才的硅基流动 API Key 填到 `SILICONFLOW_API_KEY`
7. 等 3~5 分钟构建完成。域名形如 `https://gongzhonghao-wechat-xxxx.onrender.com`

### Step 3：把 Render 出口 IP 加入微信白名单

这一步**必须做**，不然调微信 API 会报"IP 未在白名单"。

1. 在 Render Dashboard → 你的服务 → **Connect** 标签 → 看 **Outbound IPs**，会给你 2~3 个 IP
2. 打开微信公众平台 → 设置与开发 → 基本配置 → **IP 白名单** → 把这些 IP 全部加进去
3. 保存

> ⚠️ Render 的出口 IP 偶尔会增加，如果后面某天推送失败报"IP 未在白名单"，回来看看是否多了新 IP。

### Step 4：试用

1. 打开 Render 给你的域名
2. 点右上角 **设置** → 输入你的公众号 AppID / AppSecret → 保存
3. 编辑 Markdown → 点 **推送到草稿箱** → 填标题
4. 想用 AI 生图：在紫色面板填描述（或留空用标题自动生成）→ 点"生成封面图" → 等 15~30 秒
5. 点"确认推送" → 去公众号后台草稿箱看

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

**Q：生图太慢 / 想换模型？**
A：`server.ts` 里默认是 `Kwai-Kolors/Kolors`（中文友好）。想换模型，前端可以 POST 时带 `model` 字段，例如 `black-forest-labs/FLUX.1-schnell`（更快但中文语义差）。

**Q：封面图太大被微信拒？**
A：Kolors 默认输出 1024x1024。微信封面要求 < 2MB、建议 900x383。如有问题，可在生成参数里改 `size` 为 `960x384`。
