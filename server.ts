import express from 'express';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import juice from 'juice';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ dest: 'uploads/' });

// Helper to get WeChat Access Token
async function getAccessToken(appId: string, appSecret: string) {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    if (response.data.errcode) {
      throw new Error(`获取Token失败: ${response.data.errmsg} (错误码: ${response.data.errcode})。请检查 AppID/AppSecret 是否正确，以及当前服务器 IP 是否已加入微信公众号白名单。`);
    }
    return response.data.access_token;
  } catch (error: any) {
    if (error.response && error.response.data) {
      throw new Error(error.response.data.errmsg || error.message);
    }
    throw error;
  }
}

// API: Upload Image to WeChat Material Library (for thumb / cover image)
app.post('/api/wechat/upload-image', upload.single('image'), async (req, res) => {
  try {
    const { appId, appSecret } = req.body;
    const file = req.file;
    if (!file) throw new Error('No image provided');

    const token = await getAccessToken(appId, appSecret);

    const form = new FormData();
    form.append('media', fs.createReadStream(file.path), file.originalname);

    const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`;
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      timeout: 20000,
    });

    try { fs.unlinkSync(file.path); } catch {}

    if (response.data.errcode) {
      throw new Error(`上传封面图失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
    }

    res.json({ mediaId: response.data.media_id, url: response.data.url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Upload inline article image via uploadimg (does NOT consume material quota)
// This is used for images embedded inside the article body.
// WeChat returns a permanent mmbiz.qpic.cn URL that can be put into <img src>.
app.post('/api/wechat/upload-content-image', async (req, res) => {
  try {
    const { appId, appSecret, imageDataUrl, filename } = req.body;
    if (!imageDataUrl || typeof imageDataUrl !== 'string') throw new Error('缺少图片数据');

    // Parse data URL
    const match = imageDataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) throw new Error('图片数据格式错误');
    const mime = match[1];
    const buf = Buffer.from(match[2], 'base64');

    const token = await getAccessToken(appId, appSecret);
    const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : 'png';
    const name = filename || `content-${Date.now()}.${ext}`;

    const form = new FormData();
    form.append('media', buf, { filename: name, contentType: mime });

    const url = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`;
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      timeout: 20000,
    });

    if (response.data.errcode) {
      throw new Error(`上传正文图失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
    }

    res.json({ url: response.data.url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------- Image Generation Provider Layer ----------------
// Currently implements SiliconFlow (supports Flux / Kolors / SD3.5 etc).
// Kept simple; extend with a switch on `provider` to add 豆包 / OpenAI / Gemini.

const DEFAULT_IMAGE_MODEL = process.env.IMAGE_MODEL || 'black-forest-labs/FLUX.1-dev';

async function callSiliconFlow(params: { model: string; prompt: string; size: string }) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) throw new Error('服务器未配置 SILICONFLOW_API_KEY 环境变量');

  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    image_size: params.size,
    batch_size: 1,
  };

  // Different models have different optimal params
  if (params.model.includes('FLUX.1-schnell') || params.model.includes('schnell')) {
    body.num_inference_steps = 4;
  } else if (params.model.includes('FLUX.1-pro') || params.model.includes('pro')) {
    // Pro models usually ignore steps on SiliconFlow; keep sane default
    body.num_inference_steps = 28;
    body.guidance_scale = 3.5;
  } else if (params.model.includes('FLUX.1-dev')) {
    body.num_inference_steps = 28;
    body.guidance_scale = 3.5;
  } else {
    // Kolors / SD3.5 friendly defaults
    body.num_inference_steps = 20;
    body.guidance_scale = 7.5;
  }

  const sfResponse = await axios.post(
    'https://api.siliconflow.cn/v1/images/generations',
    body,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );

  const imageUrl = sfResponse.data?.images?.[0]?.url;
  if (!imageUrl) throw new Error('生图服务未返回图片地址');

  const imgResp = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  const base64 = Buffer.from(imgResp.data).toString('base64');
  const mimeType = (imgResp.headers['content-type'] as string) || 'image/png';
  return `data:${mimeType};base64,${base64}`;
}

// API: AI Generate Image (cover or content)
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, model, size } = req.body || {};
    if (!prompt || typeof prompt !== 'string') throw new Error('请输入生成提示词');

    const imageDataUrl = await callSiliconFlow({
      model: model || DEFAULT_IMAGE_MODEL,
      prompt,
      size: size || '1024x1024',
    });

    res.json({ imageDataUrl });
  } catch (error: any) {
    if (error.response?.data) {
      const data = error.response.data;
      const errMsg = typeof data === 'string' ? data : (data.message || JSON.stringify(data));
      res.status(500).json({ error: `生成图片失败: ${errMsg}` });
    } else {
      res.status(500).json({ error: error.message || '生成图片失败' });
    }
  }
});

// API: Push Draft to WeChat
app.post('/api/wechat/push-draft', async (req, res) => {
  try {
    const { appId, appSecret, title, author, digest, content, thumbMediaId } = req.body;

    const token = await getAccessToken(appId, appSecret);

    // Render Markdown to HTML
    let htmlContent = marked.parse(content) as string;

    // Convert standard HTML tags to WeChat-friendly <section> and <span> tags
    htmlContent = htmlContent.replace(/<blockquote/g, '<section class="wechat-blockquote"');
    htmlContent = htmlContent.replace(/<\/blockquote>/g, '</section>');
    htmlContent = htmlContent.replace(/<p>/g, '<section class="wechat-p">');
    htmlContent = htmlContent.replace(/<p /g, '<section class="wechat-p" ');
    htmlContent = htmlContent.replace(/<\/p>/g, '</section>');
    htmlContent = htmlContent.replace(/<h1/g, '<section class="wechat-h1"');
    htmlContent = htmlContent.replace(/<\/h1>/g, '</section>');
    htmlContent = htmlContent.replace(/<h2/g, '<section class="wechat-h2"');
    htmlContent = htmlContent.replace(/<\/h2>/g, '</section>');
    htmlContent = htmlContent.replace(/<h3/g, '<section class="wechat-h3"');
    htmlContent = htmlContent.replace(/<\/h3>/g, '</section>');
    htmlContent = htmlContent.replace(/<strong/g, '<span class="wechat-strong"');
    htmlContent = htmlContent.replace(/<\/strong>/g, '</span>');
    htmlContent = htmlContent.replace(/<ul/g, '<section class="wechat-ul"');
    htmlContent = htmlContent.replace(/<\/ul>/g, '</section>');
    htmlContent = htmlContent.replace(/<ol/g, '<section class="wechat-ol"');
    htmlContent = htmlContent.replace(/<\/ol>/g, '</section>');
    htmlContent = htmlContent.replace(/<li/g, '<section class="wechat-li"');
    htmlContent = htmlContent.replace(/<\/li>/g, '</section>');
    htmlContent = htmlContent.replace(/<hr>/g, '<section class="wechat-hr"></section>');
    htmlContent = htmlContent.replace(/<hr \/>/g, '<section class="wechat-hr"></section>');

    htmlContent = htmlContent.replace(/<div/g, '<section');
    htmlContent = htmlContent.replace(/<\/div>/g, '</section>');

    const css = `
      .wechat-container { padding: 16px; background: #ffffff; }
      .wechat-container, .wechat-p, .wechat-h1, .wechat-h2, .wechat-h3, .wechat-li, .wechat-blockquote, .wechat-strong, .wechat-ul, .wechat-ol, .wechat-hr {
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", STHeiti, "Microsoft Yahei", Tahoma, Simsun, sans-serif;
        color: #3f3f3f;
        font-size: 15px;
        line-height: 1.8;
        letter-spacing: 0.5px;
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      .wechat-p { margin: 0 0 1.2em 0; text-align: justify; display: block; }
      .wechat-h1, .wechat-h2, .wechat-h3 { color: #000000; font-weight: bold; margin: 2em 0 1em 0; line-height: 1.4; display: block; }
      .wechat-h2 { font-size: 18px; padding-left: 12px; border-left: 4px solid #d4af37; }
      .wechat-h3 { font-size: 16px; color: #d4af37; }
      .wechat-blockquote { background: #fdf9f1; border: 1px solid #e8d5a5; border-radius: 8px; padding: 16px; margin: 1.5em 0; color: #555555; font-size: 14px; display: block; }
      .wechat-blockquote .wechat-p { margin-bottom: 0; }
      .wechat-blockquote .wechat-p:not(:last-child) { margin-bottom: 0.8em; }
      .wechat-strong { color: #d4af37; font-weight: bold; }
      .wechat-hr { border: none; border-top: 1px solid #d4af37; margin: 2em auto; width: 50%; display: block; }
      img { max-width: 100%; border-radius: 8px; margin: 1em 0; display: block; }
      .wechat-ul, .wechat-ol { padding-left: 2em; margin: 0 0 1.2em 0; display: block; }
      .wechat-li { margin-bottom: 0.5em; display: list-item; list-style-position: inside; }
      .wechat-ul .wechat-li { list-style-type: disc; }
      .wechat-ol .wechat-li { list-style-type: decimal; }
    `;

    const wrappedHtml = `<section class="wechat-container"><section>${htmlContent}</section></section>`;
    const styledHtml = juice.inlineContent(wrappedHtml, css, {
      inlinePseudoElements: true,
      preserveImportant: false
    });

    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;
    const payload = {
      articles: [
        {
          title,
          author,
          digest,
          content: styledHtml,
          thumb_media_id: thumbMediaId || '',
          need_open_comment: 0,
          only_fans_can_comment: 0
        }
      ]
    };

    const response = await axios.post(url, payload, { timeout: 15000 });

    if (response.data.errcode) {
      throw new Error(`推送草稿失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
    }

    res.json({ success: true, mediaId: response.data.media_id });
  } catch (error: any) {
    if (error.response && error.response.data) {
      res.status(500).json({ error: error.response.data.errmsg || error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Vite middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
