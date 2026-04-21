import React, { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Settings, Send, Copy, Check, Image as ImageIcon, X, Sparkles } from 'lucide-react';

const DEFAULT_MARKDOWN = `## 财帛宫：你天生适合哪种财路

紫微斗数把财富来源分成两大类——"正财"和"偏财"。正财是靠稳定薪资、专业技能积累的财富；偏财是靠投资、生意、机遇获得的财富。两种财路没有好坏之分，关键是你的命盘适合哪一种。

财帛宫坐天府星、太阳星的人，天生适合正财，越稳定越旺，做生意反而容易亏；财帛宫坐武曲星、破军星的人，天生偏财格局，朝九晚五反而压制财运，越折腾越有钱。

这也解释了为什么有些人辞职创业之后反而越来越好，而有些人创业却越做越亏——不是能力问题，是命盘里的财路格局决定了方向。

> 💡 **提示：想要这种带背景色的卡片效果？**
> 只需要在段落前面加上 \`>\` 符号和一个空格即可！
> 像这样写，推送到微信后就会自动变成带有米黄色背景和金色边框的精美卡片。

<p style="text-align:center; color:#d4af37; letter-spacing: 8px; font-weight: bold; margin: 2em 0;">· · ·</p>

## 大限流年：财运不是一条直线，有高峰也有低谷

很多人不知道，紫微斗数里的财运是有"时间节点"的。每个人一生会经历不同的"大限"，每个大限十年，财运好坏差异巨大。

有些人三十岁前财运平平，三十五岁之后突然爆发——不是运气，是大限走到了财帛宫或福德宫。有些人年轻时风光，四十岁后却越来越难——也不是能力退步，而是大限转换，财运进入了收敛期。`;

export default function App() {
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
  
  const [showSettings, setShowSettings] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [digest, setDigest] = useState('');
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [uploadedMediaId, setUploadedMediaId] = useState<string>('');
  
  const [isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushError, setPushError] = useState('');
  
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // AI image generation state
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  useEffect(() => {
    const savedAppId = localStorage.getItem('wechat_appid');
    const savedAppSecret = localStorage.getItem('wechat_appsecret');
    if (savedAppId) setAppId(savedAppId);
    if (savedAppSecret) setAppSecret(savedAppSecret);
  }, []);

  const saveSettings = () => {
    localStorage.setItem('wechat_appid', appId);
    localStorage.setItem('wechat_appsecret', appSecret);
    setShowSettings(false);
  };

  const handlePush = async () => {
    if (!appId || !appSecret) {
      setPushError('请先配置 AppID 和 AppSecret');
      return;
    }
    if (!title) {
      setPushError('请输入文章标题');
      return;
    }
    if (!coverImage) {
      setPushError('请上传封面图（微信接口要求必须有封面图）');
      return;
    }

    setIsPushing(true);
    setPushError('');
    setPushSuccess(false);

    try {
      let thumbMediaId = uploadedMediaId;
      
      // If cover image is provided and not uploaded yet, upload it first
      if (coverImage && !thumbMediaId) {
        const formData = new FormData();
        formData.append('appId', appId);
        formData.append('appSecret', appSecret);
        formData.append('image', coverImage);
        
        const uploadRes = await fetch('/api/wechat/upload-image', {
          method: 'POST',
          body: formData,
        });
        
        let uploadData;
        const contentType = uploadRes.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          uploadData = await uploadRes.json();
        } else {
          const text = await uploadRes.text();
          if (text.includes('Please wait while your application starts') || text.includes('正在启动')) {
            throw new Error('服务器正在重启或唤醒中，请等待几秒钟后再试。');
          }
          throw new Error(`上传封面图失败: 服务器返回了非预期的格式 (HTTP ${uploadRes.status})。响应内容前100个字符: ${text.substring(0, 100)}`);
        }
        
        if (!uploadRes.ok) throw new Error(uploadData.error || '上传封面图失败');
        
        thumbMediaId = uploadData.mediaId;
        setUploadedMediaId(thumbMediaId);
      }

      // Push draft
      const pushRes = await fetch('/api/wechat/push-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId,
          appSecret,
          title,
          author,
          digest,
          content: markdown,
          thumbMediaId
        }),
      });
      
      let pushData;
      const pushContentType = pushRes.headers.get('content-type');
      if (pushContentType && pushContentType.includes('application/json')) {
        pushData = await pushRes.json();
      } else {
        const text = await pushRes.text();
        if (text.includes('Please wait while your application starts') || text.includes('正在启动')) {
          throw new Error('服务器正在重启或唤醒中，请等待几秒钟后再试。');
        }
        throw new Error(`推送草稿失败: 服务器返回了非预期的格式 (HTTP ${pushRes.status})。响应内容前100个字符: ${text.substring(0, 100)}`);
      }
      
      if (!pushRes.ok) throw new Error(pushData.error || '推送草稿失败');
      
      setPushSuccess(true);
      setTimeout(() => {
        setShowPushModal(false);
        setPushSuccess(false);
      }, 2000);
    } catch (err: any) {
      setPushError(err.message);
    } finally {
      setIsPushing(false);
    }
  };

  const handleGenerateImage = async () => {
    const promptText = aiPrompt.trim() || (title ? `${title}，中国风水墨画，玄学氛围，金色点缀，高级质感` : '');
    if (!promptText) {
      setGenError('请先输入提示词，或在上方填好文章标题');
      return;
    }
    setIsGenerating(true);
    setGenError('');
    try {
      const resp = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
      });
      let data;
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await resp.json();
      } else {
        const text = await resp.text();
        throw new Error(`生成失败: 服务器返回非 JSON (HTTP ${resp.status}) ${text.substring(0, 100)}`);
      }
      if (!resp.ok) throw new Error(data.error || '生成图片失败');

      // Convert data URL → Blob → File, then feed existing coverImage flow
      const dataUrl: string = data.imageDataUrl;
      const blobResp = await fetch(dataUrl);
      const blob = await blobResp.blob();
      const file = new File([blob], `ai-cover-${Date.now()}.png`, { type: blob.type || 'image/png' });
      setCoverImage(file);
      setUploadedMediaId(''); // reset cache so it will re-upload to wechat
    } catch (err: any) {
      setGenError(err.message || '生成图片失败');
    } finally {
      setIsGenerating(false);
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
          <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 text-sm font-medium text-gray-600">
            Markdown 编辑器
          </div>
          <textarea
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
                <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{markdown}</Markdown>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[480px] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-800">公众号配置</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">AppID</label>
                <input 
                  type="text" 
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="请输入微信公众号 AppID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">AppSecret</label>
                <input 
                  type="password" 
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="请输入微信公众号 AppSecret"
                />
              </div>
              <p className="text-xs text-gray-500">
                请在微信公众平台「开发 - 基本配置」中获取。您的配置仅保存在本地浏览器中，不会上传到我们的服务器。
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button 
                onClick={saveSettings}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700"
              >
                保存
              </button>
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
            
            {(pushError || pushSuccess) && (
              <div className="px-6 pt-4 shrink-0">
                {pushError && (
                  <div className="p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200 break-words">
                    {pushError}
                  </div>
                )}
                {pushSuccess && (
                  <div className="p-3 bg-green-50 text-green-700 text-sm rounded-md border border-green-200 flex items-center gap-2">
                    <Check size={16} /> 推送成功！请前往微信公众平台草稿箱查看。
                  </div>
                )}
              </div>
            )}

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">文章标题 <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="请输入文章标题"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">作者</label>
                <input 
                  type="text" 
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="选填"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">摘要</label>
                <textarea 
                  value={digest}
                  onChange={(e) => setDigest(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  placeholder="选填"
                />
              </div>
              <div className="p-3 bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-md">
                <label className="flex items-center gap-1.5 text-sm font-medium text-purple-800 mb-2">
                  <Sparkles size={14} /> AI 生成封面（可选）
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-purple-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none bg-white"
                  placeholder="输入画面描述。留空则用文章标题 + 默认风格（中国风水墨、玄学、金色）"
                />
                {genError && (
                  <div className="mt-2 p-2 bg-red-50 text-red-700 text-xs rounded border border-red-200 break-words">
                    {genError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleGenerateImage}
                  disabled={isGenerating}
                  className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      生成中（约 15~30 秒）...
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} /> 生成封面图
                    </>
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
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setCoverImage(e.target.files[0]);
                          setUploadedMediaId(''); // Reset media ID cache
                        }
                      }}
                    />
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
              <button 
                onClick={() => setShowPushModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isPushing}
              >
                取消
              </button>
              <button 
                onClick={handlePush}
                disabled={isPushing}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isPushing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    推送中...
                  </>
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
