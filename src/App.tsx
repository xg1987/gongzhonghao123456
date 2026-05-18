import React, { useState, useEffect, useRef, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Settings, Send, Copy, Check, Image as ImageIcon, X, Sparkles, Plus, AlertTriangle, Mic, Monitor, Moon, Sun, BarChart3 } from 'lucide-react';

const DEFAULT_MARKDOWN = `## 财帛宫：你天生适合哪种财路

紫微斗数把财富来源分成两大类——"正财"和"偏财"。正财是靠稳定薪资、专业技能积累的财富；偏财是靠投资、生意、机遇获得的财富。两种财路没有好坏之分，关键是你的命盘适合哪一种。

![](ai://一枚古铜色的紫微斗数命盘 居中 氤氲的金色雾气环绕 暗色背景 高级质感)

财帛宫坐天府星、太阳星的人，天生适合正财，越稳定越旺，做生意反而容易亏；财帛宫坐武曲星、破军星的人，天生偏财格局，朝九晚五反而压制财运，越折腾越有钱。

这也解释了为什么有些人辞职创业之后反而越来越好，而有些人创业却越做越亏——不是能力问题，是命盘里的财路格局决定了方向。

> 💡 **提示：想要这种带背景色的卡片效果？**
> 只需要在段落前面加上 \`>\` 符号和一个空格即可！
> 像这样写，推送到微信后就会自动变成带有米黄色背景和金色边框的精美卡片。

<p style="text-align:center; color:#d4af37; letter-spacing: 8px; font-weight: bold; margin: 2em 0;">· · ·</p>

## 大限流年：财运不是一条直线，有高峰也有低谷

很多人不知道，紫微斗数里的财运是有"时间节点"的。每个人一生会经历不同的"大限"，每个大限十年，财运好坏差异巨大。

有些人三十岁前财运平平，三十五岁之后突然爆发——不是运气，是大限走到了财帛宫或福德宫。有些人年轻时风光，四十岁后却越来越难——也不是能力退步，而是大限转换，财运进入了收敛期。`;

// Style presets appended to prompts
const STYLE_PRESETS: Record<string, { label: string; suffix: string }> = {
  inkwash: { label: '🎋 中国风水墨（玄学、国风）', suffix: '，中国风水墨画，写意，留白，金色点缀，玄学氛围，高级质感，4k' },
  photo:   { label: '📷 现代摄影（商业、科技）', suffix: '，现代摄影风格，电影感光影，高清细节，景深，4k' },
  illus:   { label: '🎨 插画手绘（生活、情感）', suffix: '，手绘插画风格，柔和配色，温暖氛围，精致线条' },
  custom:  { label: '✏️ 自定义', suffix: '' },
};

// Models available on SiliconFlow
const IMAGE_MODELS: { id: string; label: string; note: string }[] = [
  { id: 'black-forest-labs/FLUX.1-dev',      label: 'FLUX.1 dev（推荐·顶级质感）', note: '¥0.035/张 约 20 秒' },
  { id: 'black-forest-labs/FLUX.1-schnell',  label: 'FLUX.1 schnell（最快）',       note: '¥0.003/张 约 5 秒' },
  { id: 'Kwai-Kolors/Kolors',                label: 'Kolors（中文最懂·平价）',       note: '¥0.005/张 约 15 秒' },
];

const MAX_INLINE_IMAGES = 3;
const MAX_PIC_IMAGES = 20;
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const MAX_STORY_AUDIO_BYTES = 50 * 1024 * 1024;
const RECOMMENDED_COVER_RATIO = 900 / 383;
const CACHE_KEY = 'ai_image_url_cache_v1';
const DRAFT_KEY = 'wechat_draft_autosave_v1';
const STORY_HISTORY_KEY = 'wechat_story_material_history_v1';
const THEME_KEY = 'wechat_theme_mode_v1';

type DraftType = 'news' | 'newspic' | 'story';
type ThemeMode = 'auto' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

type DraftSnapshot = {
  markdown: string;
  title: string;
  author: string;
  digest: string;
  draftType: DraftType;
  picContent: string;
  aiPrompt: string;
};

type CoverMeta = {
  width: number;
  height: number;
};

type PreflightItem = {
  level: 'ok' | 'warning' | 'error';
  text: string;
};

type StoryUploadRecord = {
  mediaId: string;
  filename: string;
  uploadedAt: string;
};

type AnalyticsReport = {
  range: {
    startDate: string;
    endDate: string;
    days: number;
    generatedAt: string;
  };
  totals: {
    articleCount: number;
    readUsers: number;
    readCount: number;
    shareUsers: number;
    shareCount: number;
    collections: number;
    likes: number;
    zaikan: number;
    comments: number;
    readSubscribeUsers: number;
    newUsers: number;
    cancelUsers: number;
    netUsers: number;
    latestCumulateUsers: number;
  };
  topArticles: Array<{
    msgid: string;
    title: string;
    readUsers: number;
    readCount: number;
    shareUsers: number;
    shareCount: number;
    collections: number;
    likes: number;
    zaikan: number;
    comments: number;
    readSubscribeUsers: number;
    shareRate: number;
    collectionRate: number;
    subscribeRate: number;
    avgFinishRate: number;
    categories: string[];
  }>;
  categoryPerformance: Array<{
    name: string;
    articles: number;
    readUsers: number;
    avgReadUsers: number;
    shareUsers: number;
    collections: number;
    shareRate: number;
    collectionRate: number;
  }>;
  recommendations: string[];
  notes: string[];
  errors: string[];
};

function normalizeDraftType(value: unknown): DraftType {
  if (value === 'newspic') return 'newspic';
  if (value === 'story' || value === 'voice') return 'story';
  return 'news';
}

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Scan markdown for ai://prompt placeholders
function extractAiImages(md: string): { full: string; prompt: string }[] {
  const re = /!\[[^\]]*\]\(ai:\/\/([^)]+)\)/g;
  const results: { full: string; prompt: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    results.push({ full: m[0], prompt: m[1].trim() });
  }
  return results;
}

// Read/write wechat-URL cache (key: full prompt including style suffix)
function loadCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveCache(c: Record<string, string>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}

function loadDraftSnapshot(): Partial<DraftSnapshot> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null || Number.isNaN(seconds)) return '未知时长';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function formatCount(value: number | undefined) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function formatPercent(value: number | undefined) {
  return `${(((value || 0) * 100)).toFixed(1)}%`;
}

function isSupportedStoryAudioFile(file: File) {
  return /\.(mp3|m4a|aac|wav|ogg|flac|amr|wma)$/i.test(file.name) || /^audio\//i.test(file.type);
}

function loadStoryHistory(): StoryUploadRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORY_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const savedDraftRef = useRef<Partial<DraftSnapshot>>(loadDraftSnapshot());
  const [markdown, setMarkdown] = useState(savedDraftRef.current.markdown || DEFAULT_MARKDOWN);

  const [showSettings, setShowSettings] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].id);
  const [stylePreset, setStylePreset] = useState<keyof typeof STYLE_PRESETS>('inkwash');
  const [customStyle, setCustomStyle] = useState('');

  const [title, setTitle] = useState(savedDraftRef.current.title || '');
  const [author, setAuthor] = useState(savedDraftRef.current.author || '');
  const [digest, setDigest] = useState(savedDraftRef.current.digest || '');
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [coverMeta, setCoverMeta] = useState<CoverMeta | null>(null);
  const [uploadedMediaId, setUploadedMediaId] = useState<string>('');
  const [draftType, setDraftType] = useState<DraftType>(normalizeDraftType(savedDraftRef.current.draftType));
  const [picContent, setPicContent] = useState(savedDraftRef.current.picContent || '');
  const [picImages, setPicImages] = useState<File[]>([]);
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [storyDuration, setStoryDuration] = useState<number | null>(null);
  const [storyPreviewUrl, setStoryPreviewUrl] = useState('');
  const [storyMediaId, setStoryMediaId] = useState('');
  const [storyHistory, setStoryHistory] = useState<StoryUploadRecord[]>(loadStoryHistory);
  const [storyCopied, setStoryCopied] = useState(false);

  const [isPushing, setIsPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState(''); // progress text
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushError, setPushError] = useState('');
  const [analyticsDays, setAnalyticsDays] = useState(7);
  const [analyticsReport, setAnalyticsReport] = useState<AnalyticsReport | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // AI cover image state
  const [aiPrompt, setAiPrompt] = useState(savedDraftRef.current.aiPrompt || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  // Insert-inline-image mini dialog state
  const [showInsertDialog, setShowInsertDialog] = useState(false);
  const [insertPrompt, setInsertPrompt] = useState('');
  const resolvedTheme: ResolvedTheme = themeMode === 'auto' ? systemTheme : themeMode;
  const themeOptions: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'auto', label: '跟随系统', icon: <Monitor size={16} /> },
    { mode: 'light', label: '白天模式', icon: <Sun size={16} /> },
    { mode: 'dark', label: '黑夜模式', icon: <Moon size={16} /> },
  ];

  useEffect(() => {
    const savedAppId = localStorage.getItem('wechat_appid');
    const savedAppSecret = localStorage.getItem('wechat_appsecret');
    const savedModel = localStorage.getItem('image_model');
    const savedStyle = localStorage.getItem('style_preset');
    const savedCustom = localStorage.getItem('custom_style');
    if (savedAppId) setAppId(savedAppId);
    if (savedAppSecret) setAppSecret(savedAppSecret);
    if (savedModel) setImageModel(savedModel);
    if (savedStyle && STYLE_PRESETS[savedStyle]) setStylePreset(savedStyle as keyof typeof STYLE_PRESETS);
    if (savedCustom) setCustomStyle(savedCustom);
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    syncSystemTheme();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', syncSystemTheme);
      return () => mediaQuery.removeEventListener('change', syncSystemTheme);
    }

    mediaQuery.addListener(syncSystemTheme);
    return () => mediaQuery.removeListener(syncSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = themeMode;
    document.documentElement.style.colorScheme = resolvedTheme;
    try { localStorage.setItem(THEME_KEY, themeMode); } catch {}
  }, [themeMode, resolvedTheme]);

  useEffect(() => {
    const snapshot: DraftSnapshot = {
      markdown,
      title,
      author,
      digest,
      draftType,
      picContent,
      aiPrompt,
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot)); } catch {}
  }, [markdown, title, author, digest, draftType, picContent, aiPrompt]);

  useEffect(() => {
    if (!coverImage) {
      setCoverMeta(null);
      return;
    }

    const url = URL.createObjectURL(coverImage);
    const img = new window.Image();
    img.onload = () => {
      setCoverMeta({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setCoverMeta(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [coverImage]);

  useEffect(() => {
    if (!storyFile) {
      setStoryDuration(null);
      setStoryPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(storyFile);
    setStoryPreviewUrl(url);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
      setStoryDuration(audio.duration);
    };
    audio.onerror = () => {
      setStoryDuration(null);
    };
    return () => URL.revokeObjectURL(url);
  }, [storyFile]);

  useEffect(() => {
    try { localStorage.setItem(STORY_HISTORY_KEY, JSON.stringify(storyHistory)); } catch {}
  }, [storyHistory]);

  const saveSettings = () => {
    localStorage.setItem('wechat_appid', appId);
    localStorage.setItem('wechat_appsecret', appSecret);
    localStorage.setItem('image_model', imageModel);
    localStorage.setItem('style_preset', stylePreset);
    localStorage.setItem('custom_style', customStyle);
    setShowSettings(false);
  };

  // Build full prompt with style suffix
  const buildFullPrompt = (rawPrompt: string) => {
    const suffix = stylePreset === 'custom' ? (customStyle ? `，${customStyle}` : '') : STYLE_PRESETS[stylePreset].suffix;
    return `${rawPrompt}${suffix}`;
  };

  // Call backend to generate image, return data URL
  const generateImage = async (rawPrompt: string, size = '1024x1024'): Promise<string> => {
    const fullPrompt = buildFullPrompt(rawPrompt);
    const resp = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullPrompt, model: imageModel, size }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await resp.text();
      throw new Error(`生成失败: 服务器返回非 JSON (HTTP ${resp.status}) ${text.substring(0, 100)}`);
    }
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '生成图片失败');
    return data.imageDataUrl as string;
  };

  // Upload a data URL to WeChat uploadimg, return mmbiz.qpic.cn URL
  const uploadContentImage = async (imageDataUrl: string): Promise<string> => {
    const resp = await fetch('/api/wechat/upload-content-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, appSecret, imageDataUrl }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await resp.text();
      throw new Error(`上传正文图失败: 服务器返回非 JSON (HTTP ${resp.status}) ${text.substring(0, 100)}`);
    }
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '上传正文图失败');
    return data.url as string;
  };

  const uploadPermanentImage = async (image: File, failureLabel: string): Promise<string> => {
    const formData = new FormData();
    formData.append('appId', appId);
    formData.append('appSecret', appSecret);
    formData.append('image', image);
    const uploadRes = await fetch('/api/wechat/upload-image', { method: 'POST', body: formData });
    const ct = uploadRes.headers.get('content-type') || '';
    let uploadData: any;
    if (ct.includes('application/json')) {
      uploadData = await uploadRes.json();
    } else {
      const t = await uploadRes.text();
      if (t.includes('Please wait') || t.includes('正在启动')) throw new Error('服务器正在重启或唤醒中，请等待几秒钟后再试。');
      throw new Error(`${failureLabel}: HTTP ${uploadRes.status}`);
    }
    if (!uploadRes.ok) throw new Error(uploadData.error || failureLabel);
    return uploadData.mediaId;
  };

  const uploadStoryMaterial = async (audio: File): Promise<string> => {
    const formData = new FormData();
    formData.append('appId', appId);
    formData.append('appSecret', appSecret);
    formData.append('title', title.trim() || audio.name.replace(/\.[^.]+$/, ''));
    formData.append('introduction', digest.trim() || '长故事音频');
    formData.append('audio', audio);
    const uploadRes = await fetch('/api/wechat/upload-story-audio', { method: 'POST', body: formData });
    const ct = uploadRes.headers.get('content-type') || '';
    let uploadData: any;
    if (ct.includes('application/json')) {
      uploadData = await uploadRes.json();
    } else {
      const t = await uploadRes.text();
      if (t.includes('Please wait') || t.includes('正在启动')) throw new Error('服务器正在重启或唤醒中，请等待几秒钟后再试。');
      throw new Error(`上传长故事素材失败: HTTP ${uploadRes.status}`);
    }
    if (!uploadRes.ok) throw new Error(uploadData.error || '上传长故事素材失败');
    return uploadData.mediaId;
  };

  // ---- AI cover image ----
  const handleGenerateCover = async () => {
    const promptText = aiPrompt.trim() || title;
    if (!promptText) {
      setGenError('请先输入提示词，或在上方填好文章标题');
      return;
    }
    setIsGenerating(true);
    setGenError('');
    try {
      const dataUrl = await generateImage(promptText, '960x384');
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `ai-cover-${Date.now()}.png`, { type: blob.type || 'image/png' });
      setCoverImage(file);
      setUploadedMediaId('');
    } catch (err: any) {
      setGenError(err.message || '生成图片失败');
    } finally {
      setIsGenerating(false);
    }
  };

  // ---- Insert inline AI image into markdown ----
  const currentInlineCount = useMemo(() => extractAiImages(markdown).length, [markdown]);

  const preflightItems = useMemo<PreflightItem[]>(() => {
    const items: PreflightItem[] = [];
    const hasCredentials = Boolean(appId.trim() && appSecret.trim());

    if (hasCredentials) {
      items.push({ level: 'ok', text: '公众号 AppID / AppSecret 已填写' });
    } else {
      items.push({ level: 'error', text: '请先在设置里填写公众号 AppID 和 AppSecret' });
    }

    if (draftType === 'news') {
      if (title.trim()) {
        items.push({ level: 'ok', text: '文章标题已填写' });
      } else {
        items.push({ level: 'error', text: '请填写文章标题' });
      }

      if (!coverImage) {
        items.push({ level: 'error', text: '普通文章必须上传封面图' });
      } else {
        const supportedType = /^image\/(bmp|png|jpe?g|gif)$/i.test(coverImage.type) || /\.(bmp|png|jpe?g|gif)$/i.test(coverImage.name);
        if (!supportedType) {
          items.push({ level: 'warning', text: `封面格式可能不被微信接受：${coverImage.type || coverImage.name}` });
        }
        if (coverImage.size > MAX_COVER_BYTES) {
          items.push({ level: 'error', text: `封面图 ${formatFileSize(coverImage.size)}，超过微信 2MB 限制` });
        } else {
          items.push({ level: 'ok', text: `封面大小 ${formatFileSize(coverImage.size)}，符合 2MB 限制` });
        }
        if (coverMeta) {
          const ratio = coverMeta.width / coverMeta.height;
          const ratioDelta = Math.abs(ratio - RECOMMENDED_COVER_RATIO) / RECOMMENDED_COVER_RATIO;
          if (ratioDelta > 0.18) {
            items.push({ level: 'warning', text: `封面比例 ${coverMeta.width} x ${coverMeta.height}，建议接近 900 x 383` });
          } else {
            items.push({ level: 'ok', text: `封面比例 ${coverMeta.width} x ${coverMeta.height}，接近推荐比例` });
          }
        }
      }

      if (currentInlineCount > MAX_INLINE_IMAGES) {
        items.push({ level: 'error', text: `正文 AI 插图 ${currentInlineCount} 张，超过 ${MAX_INLINE_IMAGES} 张上限` });
      } else if (currentInlineCount > 0) {
        items.push({ level: 'ok', text: `正文 AI 插图 ${currentInlineCount}/${MAX_INLINE_IMAGES}，推送时会自动生成并上传` });
      } else {
        items.push({ level: 'ok', text: '正文没有 AI 插图占位，可直接推送' });
      }
    } else if (draftType === 'newspic') {
      if (title.trim()) {
        items.push({ level: 'ok', text: '贴图标题已填写' });
      } else {
        items.push({ level: 'error', text: '请填写贴图标题' });
      }

      if (picImages.length === 0) {
        items.push({ level: 'error', text: '贴图草稿至少需要 1 张图片' });
      } else if (picImages.length > MAX_PIC_IMAGES) {
        items.push({ level: 'error', text: `贴图图片 ${picImages.length} 张，超过 ${MAX_PIC_IMAGES} 张上限` });
      } else {
        items.push({ level: 'ok', text: `贴图图片 ${picImages.length}/${MAX_PIC_IMAGES} 张` });
      }

      const oversized = picImages.filter((file) => file.size > MAX_COVER_BYTES);
      if (oversized.length > 0) {
        items.push({ level: 'warning', text: `${oversized.length} 张贴图超过 2MB，可能被微信素材接口拒绝` });
      }
    } else {
      if (title.trim()) {
        items.push({ level: 'ok', text: '故事标题已填写' });
      } else {
        items.push({ level: 'error', text: '请填写故事标题' });
      }

      if (!storyFile) {
        items.push({ level: 'error', text: '请选择要上传的长故事音频' });
      } else {
        if (isSupportedStoryAudioFile(storyFile)) {
          items.push({ level: 'ok', text: '音频格式可转为微信视频素材' });
        } else {
          items.push({ level: 'error', text: '长故事音频支持 MP3、M4A、AAC、WAV、OGG、FLAC、AMR、WMA' });
        }

        if (storyFile.size > MAX_STORY_AUDIO_BYTES) {
          items.push({ level: 'error', text: `音频文件 ${formatFileSize(storyFile.size)}，超过 50MB 上传限制` });
        } else {
          items.push({ level: 'ok', text: `音频大小 ${formatFileSize(storyFile.size)}，服务器会压缩成 10MB 内 MP4` });
        }

        if (storyDuration !== null) {
          items.push({ level: 'ok', text: `音频时长 ${formatDuration(storyDuration)}，按长故事视频素材处理` });
        } else {
          items.push({ level: 'warning', text: '暂未读取到音频时长，上传时会自动尝试转成 MP4' });
        }
      }
    }

    return items;
  }, [appId, appSecret, title, draftType, coverImage, coverMeta, currentInlineCount, picImages, storyFile, storyDuration]);

  const blockingPreflightItems = useMemo(
    () => preflightItems.filter((item) => item.level === 'error'),
    [preflightItems]
  );

  const handleInsertInlineImage = () => {
    if (currentInlineCount >= MAX_INLINE_IMAGES) {
      alert(`一篇文章最多 ${MAX_INLINE_IMAGES} 张插图（当前已有 ${currentInlineCount} 张）。请先删除多余的再插入。`);
      return;
    }
    setInsertPrompt('');
    setShowInsertDialog(true);
  };

  const confirmInsertInlineImage = () => {
    const p = insertPrompt.trim();
    if (!p) return;
    const snippet = `\n\n![](ai://${p})\n\n`;
    const ta = editorRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = markdown.slice(0, start) + snippet + markdown.slice(end);
      setMarkdown(next);
      // set caret after the insertion
      setTimeout(() => {
        ta.focus();
        const pos = start + snippet.length;
        ta.setSelectionRange(pos, pos);
      }, 0);
    } else {
      setMarkdown(markdown + snippet);
    }
    setShowInsertDialog(false);
  };

  const addPicImages = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files);
    const next = [...picImages, ...incoming].slice(0, MAX_PIC_IMAGES);
    if (picImages.length + incoming.length > MAX_PIC_IMAGES) {
      setPushError(`贴图最多 ${MAX_PIC_IMAGES} 张，已自动保留前 ${MAX_PIC_IMAGES} 张。`);
    } else {
      setPushError('');
    }
    setPicImages(next);
  };

  const removePicImage = (index: number) => {
    setPicImages(picImages.filter((_, i) => i !== index));
  };

  // ---- Push to draft box ----
  const handlePush = async () => {
    if (blockingPreflightItems.length > 0) {
      setPushError(blockingPreflightItems[0].text);
      return;
    }

    if (!appId || !appSecret) { setPushError('请先配置 AppID 和 AppSecret'); return; }
    if (!title.trim()) { setPushError('请输入标题'); return; }

    if (draftType === 'story') {
      if (!storyFile) { setPushError('请选择要上传的长故事音频'); return; }

      setIsPushing(true);
      setPushError('');
      setPushSuccess(false);
      setStoryMediaId('');

      try {
        setPushStatus('转成长故事 MP4 并上传微信视频素材...');
        const mediaId = await uploadStoryMaterial(storyFile);
        setStoryMediaId(mediaId);
        setStoryHistory((records) => [
          { mediaId, filename: storyFile.name, uploadedAt: new Date().toISOString() },
          ...records.filter((record) => record.mediaId !== mediaId),
        ].slice(0, 5));
        setPushSuccess(true);
        setPushStatus('');
      } catch (err: any) {
        setPushError(err.message);
        setPushStatus('');
      } finally {
        setIsPushing(false);
      }
      return;
    }

    if (draftType === 'newspic') {
      if (picImages.length === 0) { setPushError('请至少上传 1 张贴图图片'); return; }
      if (picImages.length > MAX_PIC_IMAGES) { setPushError(`贴图最多支持 ${MAX_PIC_IMAGES} 张图片`); return; }

      setIsPushing(true);
      setPushError('');
      setPushSuccess(false);

      try {
        const imageMediaIds: string[] = [];
        for (let i = 0; i < picImages.length; i += 1) {
          setPushStatus(`上传贴图 ${i + 1}/${picImages.length}...`);
          const mediaId = await uploadPermanentImage(picImages[i], '上传贴图失败');
          imageMediaIds.push(mediaId);
        }

        setPushStatus('推送贴图草稿到微信...');
        const pushRes = await fetch('/api/wechat/push-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId,
            appSecret,
            title: title.trim(),
            content: picContent.trim() || title.trim(),
            articleType: 'newspic',
            imageMediaIds,
          }),
        });
        const pct = pushRes.headers.get('content-type') || '';
        let pushData: any;
        if (pct.includes('application/json')) {
          pushData = await pushRes.json();
        } else {
          const t = await pushRes.text();
          if (t.includes('Please wait') || t.includes('正在启动')) throw new Error('服务器正在重启或唤醒中，请等待几秒钟后再试。');
          throw new Error(`推送贴图草稿失败: HTTP ${pushRes.status}`);
        }
        if (!pushRes.ok) throw new Error(pushData.error || '推送贴图草稿失败');

        setPushSuccess(true);
        setPushStatus('');
        setTimeout(() => {
          setShowPushModal(false);
          setPushSuccess(false);
        }, 2500);
      } catch (err: any) {
        setPushError(err.message);
        setPushStatus('');
      } finally {
        setIsPushing(false);
      }
      return;
    }

    if (!coverImage) { setPushError('请上传封面图（微信接口要求必须有封面图）'); return; }

    const aiImages = extractAiImages(markdown);
    if (aiImages.length > MAX_INLINE_IMAGES) {
      setPushError(`正文里有 ${aiImages.length} 张 AI 插图，超过上限 ${MAX_INLINE_IMAGES}。请删除多余的。`);
      return;
    }

    setIsPushing(true);
    setPushError('');
    setPushSuccess(false);

    try {
      // Step 1: upload cover image (if not cached)
      let thumbMediaId = uploadedMediaId;
      if (!thumbMediaId) {
        setPushStatus('上传封面图中...');
        thumbMediaId = await uploadPermanentImage(coverImage, '上传封面图失败');
        setUploadedMediaId(thumbMediaId);
      }

      // Step 2: for each ai:// image, generate (or use cache) + upload to wechat
      let finalMarkdown = markdown;
      if (aiImages.length > 0) {
        const cache = loadCache();
        const tasks = aiImages.map(async (img, idx) => {
          const fullPrompt = buildFullPrompt(img.prompt);
          let wechatUrl = cache[fullPrompt];
          if (!wechatUrl) {
            setPushStatus(`生成插图 ${idx + 1}/${aiImages.length}：${img.prompt.substring(0, 20)}...`);
            try {
              const dataUrl = await generateImage(img.prompt);
              wechatUrl = await uploadContentImage(dataUrl);
              cache[fullPrompt] = wechatUrl;
            } catch (err: any) {
              console.error(`插图 ${idx + 1} 失败:`, err);
              return { full: img.full, url: '', error: err.message };
            }
          }
          return { full: img.full, url: wechatUrl, error: null as string | null };
        });

        setPushStatus(`生成 ${aiImages.length} 张插图中...（约 15~30 秒/张）`);
        const results = await Promise.all(tasks);
        saveCache(cache);

        // Replace each ai:// placeholder with the wechat URL (or gray placeholder on failure)
        const failed: number[] = [];
        results.forEach((r, i) => {
          if (r.url) {
            finalMarkdown = finalMarkdown.replace(r.full, `![](${r.url})`);
          } else {
            failed.push(i + 1);
            // inline a visible gray placeholder (1x1 transparent data, replaced with text via wechat)
            finalMarkdown = finalMarkdown.replace(r.full, `\n\n> ⚠️ 第 ${i + 1} 张 AI 插图生成失败：${aiImages[i].prompt}\n\n`);
          }
        });
        if (failed.length > 0) {
          setPushStatus(`第 ${failed.join('、')} 张生成失败，用占位文字代替，继续推送...`);
        }
      }

      // Step 3: push draft
      setPushStatus('推送草稿到微信...');
      const pushRes = await fetch('/api/wechat/push-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId, appSecret, title, author, digest,
          content: finalMarkdown,
          thumbMediaId,
          articleType: 'news',
        }),
      });
      const pct = pushRes.headers.get('content-type') || '';
      let pushData: any;
      if (pct.includes('application/json')) {
        pushData = await pushRes.json();
      } else {
        const t = await pushRes.text();
        if (t.includes('Please wait') || t.includes('正在启动')) throw new Error('服务器正在重启或唤醒中，请等待几秒钟后再试。');
        throw new Error(`推送草稿失败: HTTP ${pushRes.status}`);
      }
      if (!pushRes.ok) throw new Error(pushData.error || '推送草稿失败');

      setPushSuccess(true);
      setPushStatus('');
      setTimeout(() => {
        setShowPushModal(false);
        setPushSuccess(false);
      }, 2500);
    } catch (err: any) {
      setPushError(err.message);
      setPushStatus('');
    } finally {
      setIsPushing(false);
    }
  };

  const handleCopy = () => {
    if (previewRef.current) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(previewRef.current);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('copy');
      selection?.removeAllRanges();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyStoryMediaId = async (mediaId = storyMediaId) => {
    if (!mediaId) return;
    await navigator.clipboard.writeText(mediaId);
    setStoryCopied(true);
    setTimeout(() => setStoryCopied(false), 2000);
  };

  const handleLoadAnalytics = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setAnalyticsError('请先在设置里填写公众号 AppID 和 AppSecret');
      return;
    }

    setAnalyticsLoading(true);
    setAnalyticsError('');
    try {
      const resp = await fetch('/api/wechat/analytics/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, appSecret, days: analyticsDays }),
      });
      const ct = resp.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await resp.json() : { error: await resp.text() };
      if (!resp.ok) throw new Error(data.error || '读取数据分析失败');
      setAnalyticsReport(data);
    } catch (err: any) {
      setAnalyticsError(err.message || '读取数据分析失败');
      setAnalyticsReport(null);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // Custom image renderer: ai:// -> styled placeholder
  const imgRenderer = (props: any) => {
    const src = props.src || '';
    if (src.startsWith('ai://')) {
      const prompt = decodeURIComponent(src.slice(5));
      return (
        <div className="my-4 p-4 border-2 border-dashed border-purple-300 bg-purple-50 rounded-lg text-center">
          <div className="flex items-center justify-center gap-2 text-purple-700 font-medium text-sm mb-1">
            <Sparkles size={14} /> AI 插图占位
          </div>
          <div className="text-xs text-purple-600 break-words">{prompt}</div>
          <div className="text-[10px] text-purple-400 mt-1">（推送时会自动生成并上传到微信）</div>
        </div>
      );
    }
    return <img {...props} />;
  };

  return (
    <div className="app-shell min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="app-header bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <span className="text-green-600">WeChat</span> 排版助手
        </h1>
        <div className="flex items-center gap-3">
          <div className="theme-switcher" aria-label="主题模式">
            {themeOptions.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => setThemeMode(option.mode)}
                className={`theme-switcher-button ${themeMode === option.mode ? 'active' : ''}`}
                title={option.label}
                aria-label={option.label}
                aria-pressed={themeMode === option.mode}
              >
                {option.icon}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
            {copied ? '已复制' : '复制内容'}
          </button>
          <button
            onClick={() => {
              setShowAnalyticsModal(true);
              setAnalyticsError('');
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <BarChart3 size={16} />
            数据分析
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Settings size={16} />
            设置
          </button>
          <button
            onClick={() => setShowPushModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors"
          >
            <Send size={16} />
            推送/上传
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div className="editor-panel w-1/2 flex flex-col border-r border-gray-200 bg-white">
          <div className="panel-toolbar px-4 py-2 bg-gray-100 border-b border-gray-200 text-sm font-medium text-gray-600 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Markdown 编辑器</span>
              <span className="text-xs font-normal text-gray-400">已自动保存</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">AI 插图 {currentInlineCount}/{MAX_INLINE_IMAGES}</span>
              <button
                onClick={handleInsertInlineImage}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-100 border border-purple-300 rounded hover:bg-purple-200 transition-colors"
              >
                <Plus size={12} /> 插入 AI 配图
              </button>
            </div>
          </div>
          <textarea
            ref={editorRef}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            className="editor-textarea flex-1 w-full p-6 resize-none focus:outline-none text-gray-800 font-mono text-sm leading-relaxed"
            placeholder="在此输入 Markdown 内容..."
          />
        </div>

        {/* Preview */}
        <div className="preview-panel w-1/2 flex flex-col bg-gray-50">
          <div className="panel-toolbar px-4 py-2 bg-gray-100 border-b border-gray-200 text-sm font-medium text-gray-600">
            公众号预览
          </div>
          <div className="flex-1 overflow-y-auto p-8 flex justify-center">
            <div
              ref={previewRef}
              className="preview-frame w-full max-w-[375px] bg-[#f7f8fa] min-h-[667px] shadow-sm border border-gray-200 p-4 rounded-sm"
            >
              <div className="wechat-preview">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={{ img: imgRenderer as any }}
                >
                  {markdown}
                </Markdown>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Analytics Modal */}
      {showAnalyticsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[920px] overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <BarChart3 size={18} className="text-green-600" /> 数据分析
              </h2>
              <button onClick={() => setShowAnalyticsModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-gray-50 p-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">分析范围</label>
                  <div className="grid grid-cols-3 gap-1 rounded-md bg-gray-100 p-1">
                    {[7, 15, 30].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setAnalyticsDays(days)}
                        className={`px-3 py-2 text-sm font-medium rounded transition-colors ${analyticsDays === days ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                      >
                        近 {days} 天
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLoadAnalytics}
                  disabled={analyticsLoading}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {analyticsLoading ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>读取中...</>
                  ) : (
                    <><BarChart3 size={16} /> 读取报告</>
                  )}
                </button>
                <p className="text-xs text-gray-500 flex-1 min-w-[220px]">
                  只读取微信 DataCube 统计数据，不修改文章、不推送、不删除。数据通常在每天上午 8 点后稳定。
                </p>
              </div>

              {analyticsError && (
                <div className="p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200 break-words">{analyticsError}</div>
              )}

              {!analyticsReport && !analyticsError && (
                <div className="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-600">
                  选择范围后点击「读取报告」，系统会读取已发布内容的阅读、分享、收藏和用户增长数据。
                </div>
              )}

              {analyticsReport && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-gray-800">
                        {analyticsReport.range.startDate} 至 {analyticsReport.range.endDate}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">已发布内容统计，按日汇总</p>
                    </div>
                    <span className="text-xs text-gray-500">共 {analyticsReport.range.days} 天</span>
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    {[
                      ['文章数', analyticsReport.totals.articleCount],
                      ['阅读人数', analyticsReport.totals.readUsers],
                      ['分享人数', analyticsReport.totals.shareUsers],
                      ['收藏', analyticsReport.totals.collections],
                      ['新增关注', analyticsReport.totals.newUsers],
                      ['取消关注', analyticsReport.totals.cancelUsers],
                      ['净增关注', analyticsReport.totals.netUsers],
                      ['累计关注', analyticsReport.totals.latestCumulateUsers],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="text-xs text-gray-500">{label}</div>
                        <div className="mt-1 text-xl font-semibold text-gray-800">{formatCount(value as number)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-md border border-gray-200 bg-white p-4">
                      <h3 className="text-sm font-semibold text-gray-800 mb-3">栏目表现</h3>
                      <div className="space-y-2">
                        {analyticsReport.categoryPerformance.length === 0 && (
                          <p className="text-sm text-gray-500">暂无栏目数据</p>
                        )}
                        {analyticsReport.categoryPerformance.slice(0, 8).map((category) => (
                          <div key={category.name} className="flex items-center justify-between gap-3 text-sm">
                            <div>
                              <span className="font-medium text-gray-800">{category.name}</span>
                              <span className="ml-2 text-xs text-gray-500">{category.articles} 篇</span>
                            </div>
                            <div className="text-right">
                              <div className="font-medium text-gray-800">{formatCount(category.readUsers)}</div>
                              <div className="text-xs text-gray-500">分享率 {formatPercent(category.shareRate)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md border border-gray-200 bg-white p-4">
                      <h3 className="text-sm font-semibold text-gray-800 mb-3">内容建议</h3>
                      <div className="space-y-2">
                        {analyticsReport.recommendations.map((item, index) => (
                          <p key={`${item}-${index}`} className="text-sm leading-6 text-gray-700">{item}</p>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800">文章排行</h3>
                      <span className="text-xs text-gray-500">按阅读人数排序</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">标题</th>
                            <th className="px-4 py-2 text-right font-medium">阅读</th>
                            <th className="px-4 py-2 text-right font-medium">分享</th>
                            <th className="px-4 py-2 text-right font-medium">收藏</th>
                            <th className="px-4 py-2 text-right font-medium">关注</th>
                            <th className="px-4 py-2 text-right font-medium">分享率</th>
                            <th className="px-4 py-2 text-right font-medium">读完率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analyticsReport.topArticles.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-4 py-6 text-center text-gray-500">暂无文章明细</td>
                            </tr>
                          )}
                          {analyticsReport.topArticles.map((article) => (
                            <tr key={article.msgid} className="border-t border-gray-100">
                              <td className="px-4 py-3 text-gray-800 max-w-[320px]">
                                <div className="font-medium truncate">{article.title}</div>
                                <div className="text-xs text-gray-500 mt-1">{article.categories.join(' / ')}</div>
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">{formatCount(article.readUsers)}</td>
                              <td className="px-4 py-3 text-right text-gray-700">{formatCount(article.shareUsers)}</td>
                              <td className="px-4 py-3 text-right text-gray-700">{formatCount(article.collections)}</td>
                              <td className="px-4 py-3 text-right text-gray-700">{formatCount(article.readSubscribeUsers)}</td>
                              <td className="px-4 py-3 text-right text-gray-700">{formatPercent(article.shareRate)}</td>
                              <td className="px-4 py-3 text-right text-gray-700">{article.avgFinishRate > 0 ? formatPercent(article.avgFinishRate) : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {(analyticsReport.errors.length > 0 || analyticsReport.notes.length > 0) && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                      {analyticsReport.notes.map((note) => <p key={note}>{note}</p>)}
                      {analyticsReport.errors.map((error) => <p key={error}>接口提示：{error}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[540px] overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-semibold text-gray-800">设置</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="pb-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">公众号凭据</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">AppID</label>
                    <input type="text" value={appId} onChange={(e) => setAppId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="请输入微信公众号 AppID" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">AppSecret</label>
                    <input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="请输入微信公众号 AppSecret" />
                  </div>
                  <p className="text-xs text-gray-500">
                    仅保存在本地浏览器。请在「开发 - 基本配置」中获取。
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">AI 生图设置</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">画质档位（模型）</label>
                    <select value={imageModel} onChange={(e) => setImageModel(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                      {IMAGE_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label} — {m.note}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">风格预设</label>
                    <select value={stylePreset} onChange={(e) => setStylePreset(e.target.value as any)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                      {Object.entries(STYLE_PRESETS).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                  {stylePreset === 'custom' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">自定义风格后缀</label>
                      <input type="text" value={customStyle} onChange={(e) => setCustomStyle(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="如：赛博朋克 霓虹光效 高饱和" />
                    </div>
                  )}
                  <p className="text-xs text-gray-500">
                    每张 AI 图的实际提示词 = 你写的描述 + 上面选的风格后缀，这样同一篇文章视觉风格统一。
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 shrink-0">
              <button onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">取消</button>
              <button onClick={saveSettings}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Insert Inline AI Image Dialog */}
      {showInsertDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[480px] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <Sparkles size={16} className="text-purple-600" /> 插入 AI 配图占位
              </h2>
              <button onClick={() => setShowInsertDialog(false)} className="text-gray-500 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <label className="block text-sm font-medium text-gray-700">画面描述（提示词）</label>
              <textarea value={insertPrompt} onChange={(e) => setInsertPrompt(e.target.value)} rows={3}
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-sm"
                placeholder="例如：一尊古铜色紫微斗数命盘，悬浮于暗夜星空，金色符文环绕" />
              <p className="text-xs text-gray-500">
                光标位置会插入 <code className="bg-gray-100 px-1 rounded">![](ai://你的描述)</code>。
                推送到草稿箱时，系统会自动按这个描述生成图片，上传到微信，再替换到文章里。
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setShowInsertDialog(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">取消</button>
              <button onClick={confirmInsertInlineImage} disabled={!insertPrompt.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">插入</button>
            </div>
          </div>
        </div>
      )}

      {/* Push Modal */}
      {showPushModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[560px] overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-semibold text-gray-800">推送与素材上传</h2>
              <button onClick={() => setShowPushModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            {(pushError || pushSuccess || pushStatus) && (
              <div className="px-6 pt-4 shrink-0">
                {pushError && (
                  <div className="p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200 break-words">{pushError}</div>
                )}
                {pushSuccess && (
                  <div className="p-3 bg-green-50 text-green-700 text-sm rounded-md border border-green-200 flex items-center gap-2 flex-wrap">
                    <Check size={16} />
                    {draftType === 'story' ? '长故事视频素材上传成功，media_id 已生成。' : '推送成功！请前往微信公众平台草稿箱查看。'}
                    {draftType === 'story' && storyMediaId && (
                      <button
                        type="button"
                        onClick={() => handleCopyStoryMediaId()}
                        className="ml-auto px-2 py-1 text-xs font-medium text-green-700 bg-white border border-green-200 rounded hover:bg-green-50"
                      >
                        {storyCopied ? '已复制' : '复制 media_id'}
                      </button>
                    )}
                  </div>
                )}
                {pushStatus && !pushSuccess && !pushError && (
                  <div className="p-3 bg-blue-50 text-blue-700 text-sm rounded-md border border-blue-200 flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0"></div>
                    {pushStatus}
                  </div>
                )}
              </div>
            )}

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">草稿类型</label>
                <div className="grid grid-cols-3 gap-2 rounded-md bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => setDraftType('news')}
                    className={`px-3 py-2 text-sm font-medium rounded transition-colors ${draftType === 'news' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    文章
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftType('newspic')}
                    className={`px-3 py-2 text-sm font-medium rounded transition-colors ${draftType === 'newspic' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    贴图
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftType('story')}
                    className={`px-3 py-2 text-sm font-medium rounded transition-colors ${draftType === 'story' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    长故事
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-700">推送前检查</span>
                  <span className={`text-xs font-medium ${blockingPreflightItems.length > 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {blockingPreflightItems.length > 0 ? `${blockingPreflightItems.length} 项需处理` : '可以推送'}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {preflightItems.map((item, index) => (
                    <div key={`${item.text}-${index}`} className="flex items-start gap-2 text-xs leading-5">
                      {item.level === 'ok' ? (
                        <Check size={14} className="mt-0.5 shrink-0 text-green-600" />
                      ) : (
                        <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${item.level === 'error' ? 'text-red-600' : 'text-amber-600'}`} />
                      )}
                      <span className={item.level === 'error' ? 'text-red-700' : item.level === 'warning' ? 'text-amber-700' : 'text-gray-600'}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {draftType === 'news' && currentInlineCount > 0 && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-md text-sm text-purple-800">
                  📸 正文检测到 <b>{currentInlineCount}</b> 张 AI 插图占位。推送时将自动生成、上传到微信、再替换到文章里。
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{draftType === 'newspic' ? '贴图标题' : draftType === 'story' ? '故事标题' : '文章标题'} <span className="text-red-500">*</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder={draftType === 'newspic' ? '请输入贴图标题' : draftType === 'story' ? '请输入故事标题' : '请输入文章标题'} />
              </div>

              {draftType === 'news' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">作者</label>
                    <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="选填" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">摘要</label>
                    <textarea value={digest} onChange={(e) => setDigest(e.target.value)} rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                      placeholder="选填" />
                  </div>

                  <div className="p-3 bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-md">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-purple-800 mb-2">
                      <Sparkles size={14} /> AI 生成封面（可选）
                    </label>
                    <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2}
                      className="w-full px-3 py-2 text-sm border border-purple-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none bg-white"
                      placeholder="输入画面描述。留空则用文章标题" />
                    {genError && (
                      <div className="mt-2 p-2 bg-red-50 text-red-700 text-xs rounded border border-red-200 break-words">{genError}</div>
                    )}
                    <button type="button" onClick={handleGenerateCover} disabled={isGenerating}
                      className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
                      {isGenerating ? (
                        <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>生成中...</>
                      ) : (
                        <><Sparkles size={12} /> 生成封面图</>
                      )}
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">封面图 <span className="text-red-500">*</span></label>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center justify-center w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 overflow-hidden relative shrink-0">
                        {coverImage ? (
                          <img src={URL.createObjectURL(coverImage)} alt="Cover" className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center text-gray-400">
                            <ImageIcon size={24} className="mb-2" />
                            <span className="text-xs">点击上传</span>
                          </div>
                        )}
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setCoverImage(e.target.files[0]);
                              setUploadedMediaId('');
                            }
                          }} />
                      </label>
                      <div className="text-xs text-gray-500 flex-1">
                        <p className="text-red-500 font-medium mb-1">微信接口要求必须上传封面图</p>
                        <p>建议尺寸：900 x 383 像素</p>
                        <p className="mt-1">AI 封面会按接近推荐比例生成</p>
                        <p className="mt-1">支持格式：bmp, png, jpeg, jpg, gif</p>
                        <p className="mt-1">文件大小：不超过 2MB</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : draftType === 'newspic' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">贴图说明</label>
                    <textarea value={picContent} onChange={(e) => setPicContent(e.target.value)} rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                      placeholder="选填。留空时会用标题作为说明" />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">贴图图片 <span className="text-red-500">*</span></label>
                      <span className="text-xs text-gray-500">{picImages.length}/{MAX_PIC_IMAGES}</span>
                    </div>
                    <label className="flex items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <div className="flex flex-col items-center text-gray-400">
                        <ImageIcon size={24} className="mb-2" />
                        <span className="text-sm">点击选择图片，可一次多选</span>
                        <span className="text-xs mt-1">最多 20 张，上传后会进入微信素材库</span>
                      </div>
                      <input type="file" accept="image/*" multiple className="hidden"
                        onChange={(e) => {
                          addPicImages(e.target.files);
                          e.currentTarget.value = '';
                        }} />
                    </label>
                    {picImages.length > 0 && (
                      <div className="grid grid-cols-4 gap-2 mt-3">
                        {picImages.map((file, index) => (
                          <div key={`${file.name}-${index}`} className="relative aspect-square rounded-md overflow-hidden border border-gray-200 bg-gray-100">
                            <img src={URL.createObjectURL(file)} alt={`贴图 ${index + 1}`} className="w-full h-full object-cover" />
                            <button type="button" onClick={() => removePicImage(index)}
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/75"
                              aria-label={`删除第 ${index + 1} 张贴图`}>
                              <X size={14} />
                            </button>
                            <div className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
                              {index + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-2">
                      贴图草稿使用微信 newspic 结构，首张图会作为封面；图片需符合公众号素材库规则。
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
                    长故事音频会先自动转成低码率 MP4，再上传为微信永久视频素材。微信视频素材限制为 10MB，太长的故事建议分集上传。
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">长故事音频 <span className="text-red-500">*</span></label>
                    <label className="flex items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <div className="flex flex-col items-center text-gray-400">
                        <Mic size={24} className="mb-2" />
                        <span className="text-sm">点击选择故事音频</span>
                        <span className="text-xs mt-1">支持 MP3/M4A/AAC/WAV 等，上传后转为 MP4</span>
                      </div>
                      <input type="file" accept=".mp3,.m4a,.aac,.wav,.ogg,.flac,.amr,.wma,audio/*" className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            setStoryFile(e.target.files[0]);
                            setStoryMediaId('');
                            setPushError('');
                          }
                        }} />
                    </label>
                    {storyFile && (
                      <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{storyFile.name}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              {formatFileSize(storyFile.size)} · {formatDuration(storyDuration)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setStoryFile(null);
                              setStoryMediaId('');
                            }}
                            className="text-gray-500 hover:text-gray-700 shrink-0"
                            aria-label="移除音频文件"
                          >
                            <X size={18} />
                          </button>
                        </div>
                        {storyPreviewUrl && <audio src={storyPreviewUrl} controls className="mt-3 w-full" />}
                      </div>
                    )}
                  </div>

                  {storyMediaId && (
                    <div className="rounded-md border border-green-200 bg-green-50 p-3">
                      <label className="block text-xs font-medium text-green-800 mb-1">media_id</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs text-green-900 border border-green-100">{storyMediaId}</code>
                        <button
                          type="button"
                          onClick={() => handleCopyStoryMediaId()}
                          className="px-2 py-1 text-xs font-medium text-green-700 bg-white border border-green-200 rounded hover:bg-green-50 shrink-0"
                        >
                          {storyCopied ? '已复制' : '复制'}
                        </button>
                      </div>
                    </div>
                  )}

                  {storyHistory.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">最近上传</h3>
                      <div className="space-y-2">
                        {storyHistory.map((record) => (
                          <div key={record.mediaId} className="rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-600">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-gray-700 truncate">{record.filename}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyStoryMediaId(record.mediaId)}
                                className="text-green-700 hover:text-green-800 shrink-0"
                              >
                                复制
                              </button>
                            </div>
                            <code className="mt-1 block break-all text-gray-500">{record.mediaId}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 shrink-0">
              <button onClick={() => setShowPushModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isPushing}>取消</button>
              <button onClick={handlePush} disabled={isPushing}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                {isPushing ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>推送中...</>
                ) : (
                  draftType === 'story' ? '确认上传' : '确认推送'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
