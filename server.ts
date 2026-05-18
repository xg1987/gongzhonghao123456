import express from 'express';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { marked } from 'marked';
import juice from 'juice';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const require = createRequire(import.meta.url);
const ffmpegPath = (require('ffmpeg-static') as string | null) || 'ffmpeg';
const MAX_STORY_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_WECHAT_VIDEO_BYTES = 10 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ dest: 'uploads/' });

function sanitizeMaterialTitle(raw: string | undefined, fallback: string) {
  const title = (raw || fallback).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim();
  return title.substring(0, 64) || '长故事音频';
}

function isSupportedStoryAudio(file: Express.Multer.File) {
  return /\.(mp3|m4a|aac|wav|ogg|flac|amr|wma)$/i.test(file.originalname) || /^audio\//i.test(file.mimetype);
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`音频转视频失败: ${stderr.slice(-800) || `ffmpeg exited ${code}`}`));
      }
    });
  });
}

async function convertStoryAudioToVideo(inputPath: string, outputPath: string) {
  const audioBitrates = ['48k', '32k', '24k'];

  for (const bitrate of audioBitrates) {
    try { fs.unlinkSync(outputPath); } catch {}
    await runFfmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x111827:s=1280x720:r=1',
      '-i', inputPath,
      '-shortest',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'stillimage',
      '-pix_fmt', 'yuv420p',
      '-r', '1',
      '-c:a', 'aac',
      '-b:a', bitrate,
      '-ac', '1',
      '-ar', '44100',
      '-movflags', '+faststart',
      outputPath,
    ]);

    const size = fs.statSync(outputPath).size;
    if (size <= MAX_WECHAT_VIDEO_BYTES) {
      return { size, bitrate };
    }
  }

  const finalSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
  throw new Error(`长故事已转成 MP4，但大小 ${formatBytes(finalSize)} 超过微信视频素材 10MB 限制。请把音频分集，或降低原始音频时长/码率后再上传。`);
}

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

function toDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateText: string, days: number) {
  return toDateString(new Date(Date.parse(`${dateText}T00:00:00.000Z`) + days * DAY_MS));
}

function getChinaDateOffset(daysOffset: number) {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const utcDate = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()));
  return toDateString(new Date(utcDate.getTime() + daysOffset * DAY_MS));
}

function listDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function chunkDateRange(startDate: string, endDate: string, maxDays: number) {
  const chunks: { beginDate: string; endDate: string }[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const chunkEnd = addDays(cursor, maxDays - 1);
    const safeEnd = chunkEnd > endDate ? endDate : chunkEnd;
    chunks.push({ beginDate: cursor, endDate: safeEnd });
    cursor = addDays(safeEnd, 1);
  }
  return chunks;
}

function num(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function detectContentCategories(title: string) {
  const categoryWords: Record<string, string[]> = {
    紫微: ['紫微', '命宫', '财帛', '夫妻宫', '官禄', '迁移', '天府', '武曲', '破军', '流年', '大限'],
    八字: ['八字', '日主', '十神', '格局', '喜用神', '大运', '流月'],
    五行: ['五行', '金木水火土', '金命', '木命', '水命', '火命', '土命'],
    婚姻: ['婚姻', '感情', '桃花', '姻缘', '伴侣', '复合', '夫妻'],
    财运: ['财运', '财富', '赚钱', '正财', '偏财', '投资', '生意', '收入'],
    事业: ['事业', '职场', '工作', '升职', '创业', '贵人', '领导'],
    健康: ['健康', '养生', '疾病', '体质', '睡眠', '情绪'],
  };

  const matched = Object.entries(categoryWords)
    .filter(([, words]) => words.some((word) => title.includes(word)))
    .map(([name]) => name);
  return matched.length > 0 ? matched : ['其他'];
}

function callWeChatDatacube(token: string, endpoint: string, beginDate: string, endDate: string) {
  const url = `https://api.weixin.qq.com/datacube/${endpoint}?access_token=${token}`;
  return axios.post(url, { begin_date: beginDate, end_date: endDate }, { timeout: 20000 });
}

async function fetchDatacubeList(token: string, endpoint: string, beginDate: string, endDate: string) {
  const response = await callWeChatDatacube(token, endpoint, beginDate, endDate);
  const data = response.data || {};
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`${endpoint}: ${data.errmsg || '接口返回错误'} (错误码: ${data.errcode})`);
  }
  return Array.isArray(data.list) ? data.list : [];
}

function ingestArticleMetric(store: Map<string, any>, article: any, metric: any) {
  const title = article.title || metric.title || '未命名文章';
  const msgid = article.msgid || metric.msgid || `${title}-${article.ref_date || metric.ref_date || metric.stat_date || 'unknown'}`;
  const existing = store.get(msgid) || {
    msgid,
    title,
    contentUrl: article.content_url || metric.content_url || '',
    publishDate: article.ref_date || metric.ref_date || '',
    readUsers: 0,
    readCount: 0,
    shareUsers: 0,
    shareCount: 0,
    collections: 0,
    likes: 0,
    zaikan: 0,
    comments: 0,
    readSubscribeUsers: 0,
    finishRateSum: 0,
    finishRateSamples: 0,
  };

  existing.readUsers += num(metric.read_user ?? metric.int_page_read_user);
  existing.readCount += num(metric.read_count ?? metric.int_page_read_count);
  existing.shareUsers += num(metric.share_user);
  existing.shareCount += num(metric.share_count);
  existing.collections += num(metric.collection_user ?? metric.add_to_fav_user ?? metric.add_to_fav_count);
  existing.likes += num(metric.like_user);
  existing.zaikan += num(metric.zaikan_user);
  existing.comments += num(metric.comment_count);
  existing.readSubscribeUsers += num(metric.read_subscribe_user);
  const finishRate = num(metric.read_finish_rate);
  if (finishRate > 0) {
    existing.finishRateSum += finishRate;
    existing.finishRateSamples += 1;
  }

  store.set(msgid, existing);
}

function buildAnalyticsReport(params: {
  startDate: string;
  endDate: string;
  days: number;
  articleDetail: any[];
  articleFallback: any[];
  bizSummary: any[];
  userSummary: any[];
  userCumulate: any[];
  errors: string[];
}) {
  const articleMap = new Map<string, any>();

  params.articleDetail.forEach((article) => {
    const details = Array.isArray(article.detail_list) ? article.detail_list : [article];
    details.forEach((detail) => ingestArticleMetric(articleMap, article, detail));
  });

  if (articleMap.size === 0) {
    params.articleFallback.forEach((article) => ingestArticleMetric(articleMap, article, article));
  }

  const articles = Array.from(articleMap.values()).map((article) => ({
    ...article,
    categories: detectContentCategories(article.title),
    shareRate: pct(article.shareUsers, article.readUsers),
    collectionRate: pct(article.collections, article.readUsers),
    subscribeRate: pct(article.readSubscribeUsers, article.readUsers),
    avgFinishRate: article.finishRateSamples > 0 ? Number((article.finishRateSum / article.finishRateSamples).toFixed(4)) : 0,
  })).sort((a, b) => b.readUsers - a.readUsers);

  const totals = articles.reduce((sum, article) => {
    sum.readUsers += article.readUsers;
    sum.readCount += article.readCount;
    sum.shareUsers += article.shareUsers;
    sum.shareCount += article.shareCount;
    sum.collections += article.collections;
    sum.likes += article.likes;
    sum.zaikan += article.zaikan;
    sum.comments += article.comments;
    sum.readSubscribeUsers += article.readSubscribeUsers;
    return sum;
  }, {
    articleCount: articles.length,
    readUsers: 0,
    readCount: 0,
    shareUsers: 0,
    shareCount: 0,
    collections: 0,
    likes: 0,
    zaikan: 0,
    comments: 0,
    readSubscribeUsers: 0,
    newUsers: 0,
    cancelUsers: 0,
    netUsers: 0,
    latestCumulateUsers: 0,
  });

  params.userSummary.forEach((item) => {
    totals.newUsers += num(item.new_user);
    totals.cancelUsers += num(item.cancel_user);
  });
  totals.netUsers = totals.newUsers - totals.cancelUsers;

  const sortedCumulate = [...params.userCumulate].sort((a, b) => String(a.ref_date).localeCompare(String(b.ref_date)));
  totals.latestCumulateUsers = sortedCumulate.length > 0 ? num(sortedCumulate[sortedCumulate.length - 1].cumulate_user) : 0;

  const categoryMap = new Map<string, any>();
  articles.forEach((article) => {
    article.categories.forEach((category: string) => {
      const current = categoryMap.get(category) || { name: category, articles: 0, readUsers: 0, shareUsers: 0, collections: 0 };
      current.articles += 1;
      current.readUsers += article.readUsers;
      current.shareUsers += article.shareUsers;
      current.collections += article.collections;
      categoryMap.set(category, current);
    });
  });
  const categoryPerformance = Array.from(categoryMap.values()).map((category) => ({
    ...category,
    avgReadUsers: category.articles > 0 ? Math.round(category.readUsers / category.articles) : 0,
    shareRate: pct(category.shareUsers, category.readUsers),
    collectionRate: pct(category.collections, category.readUsers),
  })).sort((a, b) => b.readUsers - a.readUsers);

  const bestRead = articles[0];
  const bestShare = [...articles].sort((a, b) => b.shareRate - a.shareRate)[0];
  const bestCategory = categoryPerformance[0];
  const recommendations = [
    bestRead ? `阅读最高的是《${bestRead.title}》，可拆成系列选题继续追同类标题结构。` : '这段时间没有拿到文章明细，先确认账号是否有图文分析接口权限。',
    bestShare && bestShare.shareUsers > 0 ? `分享率较好的题目是《${bestShare.title}》，适合复盘开头钩子和转发动机。` : '暂未看到明显分享数据，标题里可增加更强的身份代入和转发理由。',
    bestCategory ? `${bestCategory.name} 类内容当前贡献最高，建议下一轮先围绕这个栏目做连续 3-5 篇测试。` : '栏目样本不足，建议保持标题里出现清晰栏目词，方便后续统计。',
    totals.netUsers < 0 ? '近段时间净增关注为负，需检查标题承诺与正文满足度，减少只吸引点击但不沉淀关注的选题。' : '近段时间关注净增为正，可以把高阅读文章末尾强化关注理由。',
  ];

  const notes = [
    '数据来自微信 DataCube，只读取已发表/已群发内容，不读取草稿箱。',
    '微信官方建议每天上午 8 点后查询前一天数据。',
    '过小阅读量的内容可能不会返回完整图文统计。',
  ];

  return {
    range: {
      startDate: params.startDate,
      endDate: params.endDate,
      days: params.days,
      generatedAt: new Date().toISOString(),
    },
    totals,
    topArticles: articles.slice(0, 10),
    categoryPerformance,
    userTrend: {
      summary: params.userSummary,
      cumulate: params.userCumulate,
    },
    bizSummary: params.bizSummary,
    recommendations,
    notes,
    errors: params.errors,
  };
}

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

// API: Upload long story audio as a WeChat permanent video material.
// WeChat voice materials are capped at 60s, so story audio is converted to MP4.
app.post('/api/wechat/upload-story-audio', upload.single('audio'), async (req, res) => {
  const file = req.file;
  let videoPath = '';
  try {
    const { appId, appSecret, title, introduction } = req.body;
    if (!file) throw new Error('No audio provided');
    if (!isSupportedStoryAudio(file)) throw new Error('长故事音频支持 MP3、M4A、AAC、WAV、OGG、FLAC、AMR、WMA 格式');
    if (file.size > MAX_STORY_AUDIO_BYTES) throw new Error(`音频文件 ${formatBytes(file.size)}，超过服务器 50MB 上传限制`);

    const token = await getAccessToken(appId, appSecret);
    const materialTitle = sanitizeMaterialTitle(title, file.originalname);
    videoPath = path.join(path.dirname(file.path), `${file.filename}-story.mp4`);
    const converted = await convertStoryAudioToVideo(file.path, videoPath);

    const form = new FormData();
    form.append('media', fs.createReadStream(videoPath), `${materialTitle}.mp4`);
    form.append('description', JSON.stringify({
      title: materialTitle,
      introduction: (introduction || '长故事音频自动转为视频素材').toString().slice(0, 120),
    }));

    const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=video`;
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      timeout: 180000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (response.data.errcode) {
      throw new Error(`上传长故事视频素材失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
    }

    res.json({
      mediaId: response.data.media_id,
      url: response.data.url || '',
      videoSize: converted.size,
      audioBitrate: converted.bitrate,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  } finally {
    if (file) {
      try { fs.unlinkSync(file.path); } catch {}
    }
    if (videoPath) {
      try { fs.unlinkSync(videoPath); } catch {}
    }
  }
});

// API: Get permanent material details through the same whitelisted server IP.
app.post('/api/wechat/get-material', async (req, res) => {
  try {
    const { appId, appSecret, mediaId } = req.body;
    if (!mediaId) throw new Error('缺少 media_id');

    const token = await getAccessToken(appId, appSecret);
    const url = `https://api.weixin.qq.com/cgi-bin/material/get_material?access_token=${token}`;
    const response = await axios.post(url, { media_id: mediaId }, { timeout: 20000 });

    if (response.data?.errcode) {
      throw new Error(`获取素材失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
    }

    res.json(response.data);
  } catch (error: any) {
    if (error.response?.data) {
      const data = error.response.data;
      const errMsg = typeof data === 'string' ? data : (data.errmsg || data.message || JSON.stringify(data));
      res.status(500).json({ error: errMsg });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// API: Delete an incorrect draft via the same whitelisted server IP.
app.post('/api/wechat/delete-draft', async (req, res) => {
  try {
    const { appId, appSecret, mediaId } = req.body;
    if (!mediaId) throw new Error('缺少草稿 media_id');

    const token = await getAccessToken(appId, appSecret);
    const url = `https://api.weixin.qq.com/cgi-bin/draft/delete?access_token=${token}`;
    const response = await axios.post(url, { media_id: mediaId }, { timeout: 15000 });

    if (response.data?.errcode) {
      throw new Error(`删除草稿失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
    }

    res.json({ success: true, errcode: response.data?.errcode ?? 0, errmsg: response.data?.errmsg || 'ok' });
  } catch (error: any) {
    if (error.response?.data) {
      const data = error.response.data;
      const errMsg = typeof data === 'string' ? data : (data.errmsg || data.message || JSON.stringify(data));
      res.status(500).json({ error: errMsg });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// API: Get draft details for verification without opening mp.weixin.qq.com.
app.post('/api/wechat/get-draft', async (req, res) => {
  try {
    const { appId, appSecret, mediaId } = req.body;
    if (!mediaId) throw new Error('缺少草稿 media_id');

    const token = await getAccessToken(appId, appSecret);
    const url = `https://api.weixin.qq.com/cgi-bin/draft/get?access_token=${token}`;
    const response = await axios.post(url, { media_id: mediaId }, { timeout: 15000 });

    if (response.data?.errcode) {
      throw new Error(`获取草稿失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
    }

    res.json(response.data);
  } catch (error: any) {
    if (error.response?.data) {
      const data = error.response.data;
      const errMsg = typeof data === 'string' ? data : (data.errmsg || data.message || JSON.stringify(data));
      res.status(500).json({ error: errMsg });
    } else {
      res.status(500).json({ error: error.message });
    }
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
    const {
      appId,
      appSecret,
      title,
      author,
      digest,
      content,
      thumbMediaId,
      articleType = 'news',
      imageMediaIds = [],
    } = req.body;

    const token = await getAccessToken(appId, appSecret);
    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;

    if (articleType === 'newspic') {
      if (!Array.isArray(imageMediaIds) || imageMediaIds.length === 0) {
        throw new Error('贴图草稿至少需要 1 张图片');
      }
      if (imageMediaIds.length > 20) {
        throw new Error('贴图草稿最多支持 20 张图片');
      }

      const payload = {
        articles: [
          {
            article_type: 'newspic',
            title,
            content: content || title || '',
            image_info: {
              image_list: imageMediaIds.map((mediaId: string) => ({
                image_media_id: mediaId,
              })),
            },
          },
        ],
      };

      const response = await axios.post(url, payload, { timeout: 15000 });

      if (response.data.errcode) {
        throw new Error(`推送贴图草稿失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
      }

      res.json({ success: true, mediaId: response.data.media_id });
      return;
    }

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

    const payload = {
      articles: [
        {
          article_type: 'news',
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

// API: Read-only WeChat analytics report through DataCube.
app.post('/api/wechat/analytics/report', async (req, res) => {
  try {
    const { appId, appSecret, days = 7 } = req.body || {};
    const rangeDays = [7, 15, 30].includes(Number(days)) ? Number(days) : 7;
    if (!appId || !appSecret) throw new Error('请先配置 AppID 和 AppSecret');

    const endDate = getChinaDateOffset(-1);
    const startDate = addDays(endDate, -(rangeDays - 1));
    const token = await getAccessToken(appId, appSecret);
    const errors: string[] = [];

    const articleDetail: any[] = [];
    const articleFallback: any[] = [];
    const bizSummary: any[] = [];
    const userSummary: any[] = [];
    const userCumulate: any[] = [];

    for (const date of listDates(startDate, endDate)) {
      try {
        articleDetail.push(...await fetchDatacubeList(token, 'getarticletotaldetail', date, date));
      } catch (error: any) {
        errors.push(error.message);
      }

      try {
        bizSummary.push(...await fetchDatacubeList(token, 'getbizsummary', date, date));
      } catch (error: any) {
        errors.push(error.message);
      }

      // Fallback for accounts that do not have the newer detailed endpoint yet.
      if (articleDetail.length === 0) {
        try {
          articleFallback.push(...await fetchDatacubeList(token, 'getarticlesummary', date, date));
        } catch (error: any) {
          errors.push(error.message);
        }
      }
    }

    for (const chunk of chunkDateRange(startDate, endDate, 7)) {
      try {
        userSummary.push(...await fetchDatacubeList(token, 'getusersummary', chunk.beginDate, chunk.endDate));
      } catch (error: any) {
        errors.push(error.message);
      }

      try {
        userCumulate.push(...await fetchDatacubeList(token, 'getusercumulate', chunk.beginDate, chunk.endDate));
      } catch (error: any) {
        errors.push(error.message);
      }
    }

    res.json(buildAnalyticsReport({
      startDate,
      endDate,
      days: rangeDays,
      articleDetail,
      articleFallback,
      bizSummary,
      userSummary,
      userCumulate,
      errors: Array.from(new Set(errors)).slice(0, 12),
    }));
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
