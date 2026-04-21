import React, { useState, useEffect, useRef, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Settings, Send, Copy, Check, Image as ImageIcon, X, Sparkles, Plus } from 'lucide-react';

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
const CACHE_KEY = 'ai_image_url_cache_v1';

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

export default function App() {
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);

  const [showSettings, setShowSettings] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);

  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].id);
  const [stylePreset, setStylePreset] = useState<keyof typeof STYLE_PRESETS>('inkwash');
  const [customStyle, setCustomStyle] = useState('');

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [digest, setDigest] = useState('');
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [uploadedMediaId, setUploadedMediaId] = useState<string>('');

  const [isPushing, setIsPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState(''); // progress text
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushError, setPushError] = useState('');

  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // AI cover image state
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  // Insert-inline-image mini dialog state
  const [showInsertDialog, setShowInsertDialog] = useState(false);
  const [insertPrompt, setInsertPrompt] = useState('');

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
  const generateImage = async (rawPrompt: string): Promise<string> => {
    const fullPrompt = buildFullPrompt(rawPrompt);
    const resp = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullPrompt, model: imageModel }),
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
      const dataUrl = await generateImage(promptText);
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

  // ---- Push to draft box ----
  const handlePush = async () => {
    if (!appId || !appSecret) { setPushError('请先配置 AppID 和 AppSecret'); return; }
    if (!title) { setPushError('请输入文章标题'); return; }
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
        const formData = new FormData();
        formData.append('appId', appId);
        formData.append('appSecret', appSecret);
        formData.append('image', coverImage);
        const uploadRes = await fetch('/api/wechat/upload-image', { method: 'POST', body: formData });
        const ct = uploadRes.headers.get('content-type') || '';
        let uploadData: any;
        if (ct.includes('application/json')) {
          uploadData = await uploadRes.json();
        } else {
          const t = await uploadRes.text();
          if (t.includes('Please wait') || t.includes('正在启动')) throw new Error('服务器正在重启或唤醒中，请等待几秒钟后再试。');
          throw new Error(`上传封面图失败: HTTP ${uploadRes.status}`);
        }
        if (!uploadRes.ok) throw new Error(uploadData.error || '上传封面图失败');
        thumbMediaId = uploadData.mediaId;
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
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <span className="text-green-600">WeChat</span> 排版助手
        </h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
            {copied ? '已复制' : '复制内容'}
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
            推送到草稿箱
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div className="w-1/2 flex flex-col border-r border-gray-200 bg-white">
          <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 text-sm font-medium text-gray-600 flex items-center justify-between">
            <span>Markdown 编辑器</span>
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
            className="flex-1 w-full p-6 resize-none focus:outline-none text-gray-800 font-mono text-sm leading-relaxed"
            placeholder="在此输入 Markdown 内容..."
          />
        </div>

        {/* Preview */}
        <div className="w-1/2 flex flex-col bg-gray-50">
          <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 text-sm font-medium text-gray-600">
            公众号预览
          </div>
          <div className="flex-1 overflow-y-auto p-8 flex justify-center">
            <div
              ref={previewRef}
              className="w-full max-w-[375px] bg-[#f7f8fa] min-h-[667px] shadow-sm border border-gray-200 p-4 rounded-sm"
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
              <h2 className="text-lg font-semibold text-gray-800">推送到草稿箱</h2>
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
                  <div className="p-3 bg-green-50 text-green-700 text-sm rounded-md border border-green-200 flex items-center gap-2">
                    <Check size={16} /> 推送成功！请前往微信公众平台草稿箱查看。
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
              {currentInlineCount > 0 && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-md text-sm text-purple-800">
                  📸 正文检测到 <b>{currentInlineCount}</b> 张 AI 插图占位。推送时将自动生成、上传到微信、再替换到文章里。
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">文章标题 <span className="text-red-500">*</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="请输入文章标题" />
              </div>
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
                    <p className="mt-1">支持格式：bmp, png, jpeg, jpg, gif</p>
                    <p className="mt-1">文件大小：不超过 2MB</p>
                  </div>
                </div>
              </div>
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
                  '确认推送'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
