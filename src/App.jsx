import React, { useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  CheckCircle,
  Edit2,
  Play,
  Download,
  Loader2,
  AlertCircle,
  ChevronRight,
  Save,
  Trash2,
  RefreshCw,
  Key,
  Eye,
  EyeOff,
  Settings,
} from 'lucide-react';

// Exponential backoff helper
const fetchWithRetry = async (url, options, maxRetries = 5) => {
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.warn(`Attempt ${i + 1} failed, retrying in ${delay}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
};

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [textModel, setTextModel] = useState('gemini-3.1-pro-preview');
  const [imageModel, setImageModel] = useState('gemini-3-pro-image-preview');
  const [showSettings, setShowSettings] = useState(false);
  const [step, setStep] = useState(1);
  const [manuscript, setManuscript] = useState('');
  const [proposals, setProposals] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [editingId, setEditingId] = useState(null);

  const buildRequest = (model, payload) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  });

  // --- Step 1: Analyze Manuscript & Propose Illustrations ---
  const handleAnalyze = async () => {
    if (!apiKey.trim()) { setGlobalError('APIキーを入力してください。'); return; }
    if (!manuscript.trim()) { setGlobalError('原稿を入力してください。'); return; }

    setIsProcessing(true);
    setGlobalError('');

    try {
      const systemInstruction = `あなたはnoteの人気クリエイターであり、プロの編集者兼アートディレクターです。
ユーザーが入力したnoteの原稿を読み込み、記事の魅力を高め、読者の理解を助けるためのイラスト（アイキャッチや図解、挿絵）を提案してください。
トーン＆マナーは「ビジネス向けかつ親しみやすい（フラットデザイン、清潔感、少しポップでわかりやすい）」を想定してください。
記事全体で3〜5枚程度のイラストを提案してください。各提案にはID、イラストの詳細な説明、およびそのイラストを挿入する目的を含めてください。`;

      const payload = {
        contents: [{ parts: [{ text: manuscript }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING', description: '例: img-1, img-2' },
                description: { type: 'STRING', description: 'イラストの具体的な内容（誰が、何を、どうしているか、どんな構図か）' },
                purpose: { type: 'STRING', description: 'なぜこのイラストが必要か、読者に何を伝えたいか' },
              },
              required: ['id', 'description', 'purpose'],
            },
          },
        },
      };

      const { url, options } = buildRequest(textModel, payload);
      const result = await fetchWithRetry(url, options);

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('AIからの応答が空でした。');

      const parsed = JSON.parse(text);
      const initialProposals = parsed.map(p => ({
        ...p,
        approved: false,
        prompt: '',
        imageUrl: '',
        status: 'idle',
      }));

      setProposals(initialProposals);
      setStep(2);
    } catch (err) {
      setGlobalError(`提案の生成に失敗しました: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Step 2/3: Proposal Management ---
  const handleUpdateProposal = (id, field, value) => {
    setProposals(prev => prev.map(p => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const toggleApproval = (id) => {
    setProposals(prev => prev.map(p => (p.id === id ? { ...p, approved: !p.approved } : p)));
  };

  const deleteProposal = (id) => {
    setProposals(prev => prev.filter(p => p.id !== id));
  };

  const addEmptyProposal = () => {
    const newId = `img-${Date.now()}`;
    setProposals(prev => [
      ...prev,
      { id: newId, description: '', purpose: '', approved: false, prompt: '', imageUrl: '', status: 'idle' },
    ]);
    setEditingId(newId);
  };

  const allApproved = proposals.length > 0 && proposals.every(p => p.approved);

  // --- Step 4: Generate Image Prompts ---
  const handleGeneratePrompts = async () => {
    setIsProcessing(true);
    setGlobalError('');

    try {
      const approvedProposals = proposals.filter(p => p.approved);
      const promptInput = JSON.stringify(
        approvedProposals.map(p => ({ id: p.id, description: p.description, purpose: p.purpose }))
      );

      const systemInstruction = `あなたはAI画像生成プロンプトの専門家です。
与えられたイラストの「説明(description)」と「目的(purpose)」から、インフォグラフィック画像を生成するAI(nanobanana)用の高品質な日本語プロンプトを作成してください。
【スタイル指定（必須）】
全てのプロンプトの末尾に、以下のスタイル指定を含めて一貫性を持たせてください：
"16：9の横長画像、きれいな線、シンプルでテキストは最小限、シンプルな白い背景、高品質、モダンなビジネスデザイン"
`;

      const payload = {
        contents: [
          {
            parts: [
              {
                text: `以下のイラスト設定を日本語の画像生成プロンプトに変換してください。日本人向けの画像です。:\n${promptInput}`,
              },
            ],
          },
        ],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                prompt: { type: 'STRING', description: 'English prompt for AI image generation' },
              },
            },
          },
        },
      };

      const { url, options } = buildRequest(textModel, payload);
      const result = await fetchWithRetry(url, options);

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(text);

      setProposals(prev =>
        prev.map(p => {
          const generated = parsed.find(g => g.id === p.id);
          return generated ? { ...p, prompt: generated.prompt } : p;
        })
      );

      setStep(4);
    } catch (err) {
      setGlobalError(`プロンプトの生成に失敗しました: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Step 5: Sequential Image Generation ---
  const handleGenerateImages = async () => {
    setStep(5);
    setGlobalError('');

    setProposals(prev =>
      prev.map(p => ({ ...p, status: p.approved ? 'idle' : p.status }))
    );

    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i];
      if (!proposal.approved) continue;

      setProposals(prev =>
        prev.map(p => (p.id === proposal.id ? { ...p, status: 'generating', error: null } : p))
      );

      try {
        const payload = {
          contents: [{ parts: [{ text: proposal.prompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE'],
          },
        };

        const { url, options } = buildRequest(imageModel, payload);
        const result = await fetchWithRetry(url, options);

        const parts = result.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find(part => part.inlineData?.mimeType?.startsWith('image/'));

        if (!imagePart?.inlineData?.data) {
          throw new Error('画像の生成データが含まれていませんでした。');
        }

        const { mimeType, data } = imagePart.inlineData;
        const imageUrl = `data:${mimeType};base64,${data}`;

        setProposals(prev =>
          prev.map(p => (p.id === proposal.id ? { ...p, imageUrl, status: 'done' } : p))
        );
      } catch (err) {
        setProposals(prev =>
          prev.map(p => (p.id === proposal.id ? { ...p, status: 'error', error: err.message } : p))
        );
      }
    }
  };

  // --- Download ---
  const downloadImage = (imageUrl, filename) => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadAll = () => {
    proposals.forEach((p, index) => {
      if (p.imageUrl) {
        setTimeout(() => {
          downloadImage(p.imageUrl, `note-illustration-${p.id}.png`);
        }, index * 500);
      }
    });
  };

  // --- Stepper UI ---
  const Stepper = () => {
    const steps = ['原稿入力', 'イラスト案の確認・修正', 'プロンプト生成', '画像生成'];
    return (
      <div className="flex items-center justify-between mb-8 px-4">
        {steps.map((s, i) => {
          const stepNum = i + 1;
          const isActive = step === stepNum || (step > 4 && stepNum === 4);
          const isPast = step > stepNum;
          return (
            <div key={i} className="flex flex-col items-center flex-1 relative">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold z-10 transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : isPast
                    ? 'bg-emerald-200 text-emerald-800'
                    : 'bg-gray-200 text-gray-400'
                }`}
              >
                {isPast ? <CheckCircle size={16} /> : stepNum}
              </div>
              <div className={`text-xs mt-2 font-medium ${isActive ? 'text-emerald-700' : 'text-gray-500'}`}>{s}</div>
              {i < steps.length - 1 && (
                <div
                  className={`absolute top-4 left-1/2 w-full h-0.5 -z-0 ${isPast ? 'bg-emerald-300' : 'bg-gray-200'}`}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-800">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="bg-emerald-500 p-2 rounded-lg">
            <ImageIcon className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-800 tracking-tight">note Illustration Gen</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* API Key & Settings */}
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Key className="text-emerald-600 w-4 h-4" />
              <span className="text-sm font-semibold text-gray-700">Gemini APIキー</span>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings(v => !v)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-emerald-600 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
              style={{ border: 'none', background: 'transparent' }}
            >
              <Settings className="w-3 h-3" />
              モデル設定
            </button>
          </div>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              className="w-full pr-10 pl-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-mono"
              placeholder="AIzaSy..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              style={{ border: 'none', background: 'transparent' }}
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            キーはブラウザ内にのみ保持されます。
          </p>

          {showSettings && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">テキスト生成モデル</label>
                <input
                  type="text"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs font-mono focus:ring-1 focus:ring-emerald-500"
                  value={textModel}
                  onChange={e => setTextModel(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">画像生成モデル</label>
                <input
                  type="text"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs font-mono focus:ring-1 focus:ring-emerald-500"
                  value={imageModel}
                  onChange={e => setImageModel(e.target.value)}
                />
              </div>
            </div>
          )}

          {!showSettings && (
            <p className="text-xs text-gray-400 mt-1">
              テキスト: <code className="bg-gray-100 px-1 rounded">{textModel}</code> ／
              画像: <code className="bg-gray-100 px-1 rounded">{imageModel}</code>
            </p>
          )}
        </div>

        <Stepper />

        {globalError && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 flex items-start gap-3 rounded shadow-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{globalError}</p>
          </div>
        )}

        {/* Step 1: Input Manuscript */}
        {step === 1 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="text-emerald-600 w-5 h-5" />
              <h2 className="text-lg font-semibold text-gray-800">noteの原稿を入力</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              AIが内容を読み込み、記事を魅力的にするイラスト（アイキャッチ・図解・挿絵）の案を提案します。
            </p>
            <textarea
              className="w-full h-80 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none mb-4 text-gray-700 leading-relaxed"
              placeholder="ここにnoteの原稿を貼り付けてください..."
              value={manuscript}
              onChange={e => setManuscript(e.target.value)}
            />
            <div className="flex justify-end">
              <button
                onClick={handleAnalyze}
                disabled={isProcessing || !manuscript.trim() || !apiKey.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-medium py-3 px-6 rounded-lg flex items-center gap-2 transition-all shadow-sm"
                style={{ border: 'none' }}
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                {isProcessing ? 'AIが原稿を解析中...' : 'イラスト案を生成する'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2/3: Review and Edit Proposals */}
        {(step === 2 || step === 3) && (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-2">提案されたイラスト案</h2>
              <p className="text-sm text-gray-500 mb-6">
                各案の内容を確認し、必要に応じて修正してください。画像生成に進む案は「承認」にチェックを入れてください。
              </p>

              <div className="space-y-4">
                {proposals.map(proposal => (
                  <div
                    key={proposal.id}
                    className={`border rounded-xl p-5 transition-all ${
                      proposal.approved ? 'border-emerald-500 bg-emerald-50/30' : 'border-gray-200 bg-white'
                    }`}
                  >
                    {editingId === proposal.id ? (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">
                            イラストの説明 (Description)
                          </label>
                          <textarea
                            value={proposal.description}
                            onChange={e => handleUpdateProposal(proposal.id, 'description', e.target.value)}
                            className="w-full p-3 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-emerald-500"
                            rows={3}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">
                            挿入の目的 (Purpose)
                          </label>
                          <input
                            type="text"
                            value={proposal.purpose}
                            onChange={e => handleUpdateProposal(proposal.id, 'purpose', e.target.value)}
                            className="w-full p-3 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={() => setEditingId(null)}
                            className="bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1 hover:bg-gray-700"
                            style={{ border: 'none' }}
                          >
                            <Save className="w-4 h-4" /> 保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-4">
                        <div className="mt-1">
                          <button
                            onClick={() => toggleApproval(proposal.id)}
                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                              proposal.approved
                                ? 'bg-emerald-500 text-white'
                                : 'text-transparent hover:border-emerald-400'
                            }`}
                            style={{
                              border: proposal.approved ? '2px solid #10b981' : '2px solid #d1d5db',
                              background: proposal.approved ? '#10b981' : 'transparent',
                            }}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded">
                              ID: {proposal.id}
                            </span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setEditingId(proposal.id)}
                                className="text-gray-500 hover:text-emerald-600 p-1"
                                style={{ border: 'none', background: 'transparent' }}
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => deleteProposal(proposal.id)}
                                className="text-gray-400 hover:text-red-500 p-1"
                                style={{ border: 'none', background: 'transparent' }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div className="mb-3">
                            <h4 className="text-sm font-semibold text-gray-800 mb-1">説明</h4>
                            <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-md">{proposal.description}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-gray-800 mb-1">目的</h4>
                            <p className="text-sm text-gray-600">{proposal.purpose}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-6">
                <button
                  onClick={addEmptyProposal}
                  className="text-emerald-600 text-sm font-medium hover:text-emerald-700 px-3 py-2 rounded-md hover:bg-emerald-50 transition-colors"
                  style={{ border: 'none', background: 'transparent' }}
                >
                  + 新しいイラスト案を追加
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(1)}
                    className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    style={{ border: 'none' }}
                  >
                    戻る
                  </button>
                  <button
                    onClick={handleGeneratePrompts}
                    disabled={!allApproved || isProcessing || proposals.length === 0}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white font-medium py-2.5 px-6 rounded-lg flex items-center gap-2 transition-all shadow-sm"
                    style={{ border: 'none' }}
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    {isProcessing ? 'プロンプト生成中...' : 'プロンプトを生成する'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Review Prompts */}
        {step === 4 && (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-2">生成されたプロンプトの確認</h2>
              <p className="text-sm text-gray-500 mb-6">
                画像生成AIに渡す英語のプロンプトが作成されました。必要に応じて微調整が可能です。
              </p>

              <div className="space-y-4">
                {proposals
                  .filter(p => p.approved)
                  .map(proposal => (
                    <div key={proposal.id} className="border border-gray-200 rounded-xl p-5 bg-white">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded">
                          ID: {proposal.id}
                        </span>
                        <span className="text-xs text-gray-500 truncate max-w-[200px]">{proposal.purpose}</span>
                      </div>
                      <textarea
                        value={proposal.prompt}
                        onChange={e => handleUpdateProposal(proposal.id, 'prompt', e.target.value)}
                        className="w-full p-3 text-sm font-mono bg-gray-50 border border-gray-300 rounded-md focus:ring-1 focus:ring-emerald-500 h-28"
                      />
                    </div>
                  ))}
              </div>

              <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-6">
                <button
                  onClick={() => setStep(3)}
                  className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  style={{ border: 'none' }}
                >
                  戻る
                </button>
                <button
                  onClick={handleGenerateImages}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 px-6 rounded-lg flex items-center gap-2 transition-all shadow-sm"
                  style={{ border: 'none' }}
                >
                  <ImageIcon className="w-4 h-4" />
                  画像を順次生成する
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Generation & Results */}
        {step >= 5 && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">生成されたイラスト</h2>
              <button
                onClick={downloadAll}
                className="bg-gray-800 hover:bg-gray-900 text-white font-medium py-2 px-4 rounded-lg flex items-center gap-2 text-sm transition-all"
                style={{ border: 'none' }}
              >
                <Download className="w-4 h-4" />
                全てダウンロード
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6">
              {proposals
                .filter(p => p.approved)
                .map(proposal => (
                  <div
                    key={proposal.id}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col md:flex-row gap-6"
                  >
                    <div className="md:w-1/2 flex-shrink-0 relative bg-gray-50 rounded-lg border border-gray-200 aspect-video flex items-center justify-center overflow-hidden">
                      {proposal.status === 'idle' && (
                        <div className="text-gray-400 flex flex-col items-center">
                          <Loader2 className="w-8 h-8 mb-2 animate-spin" />
                          <span className="text-sm">順番待ち...</span>
                        </div>
                      )}
                      {proposal.status === 'generating' && (
                        <div className="text-emerald-600 flex flex-col items-center">
                          <Loader2 className="w-10 h-10 mb-3 animate-spin" />
                          <span className="text-sm font-medium animate-pulse">画像生成中...</span>
                        </div>
                      )}
                      {proposal.status === 'error' && (
                        <div className="text-red-500 flex flex-col items-center p-4 text-center">
                          <AlertCircle className="w-8 h-8 mb-2" />
                          <span className="text-sm font-medium">生成失敗</span>
                          <span className="text-xs mt-1 text-red-400">{proposal.error}</span>
                        </div>
                      )}
                      {proposal.status === 'done' && proposal.imageUrl && (
                        <>
                          <img
                            src={proposal.imageUrl}
                            alt={proposal.description}
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => downloadImage(proposal.imageUrl, `note-${proposal.id}.png`)}
                            className="absolute bottom-3 right-3 bg-white/90 hover:bg-white text-gray-800 p-2 rounded-full shadow-md backdrop-blur-sm transition-transform hover:scale-105"
                            style={{ border: 'none' }}
                            title="この画像をダウンロード"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>

                    <div className="md:w-1/2 flex flex-col">
                      <div className="mb-2">
                        <span className="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded">
                          ID: {proposal.id}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-gray-800 mb-1">目的</h3>
                      <p className="text-sm text-gray-600 mb-4">{proposal.purpose}</p>
                      <h3 className="text-sm font-bold text-gray-800 mb-1">説明</h3>
                      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 flex-1">
                        {proposal.description}
                      </p>
                    </div>
                  </div>
                ))}
            </div>

            <div className="mt-8 flex justify-center">
              <button
                onClick={() => {
                  setStep(1);
                  setManuscript('');
                  setProposals([]);
                }}
                className="flex items-center gap-2 text-gray-500 hover:text-emerald-600 font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ border: 'none', background: 'transparent' }}
              >
                <RefreshCw className="w-4 h-4" />
                最初からやり直す
              </button>
            </div>
          </div>
        )}
      </main>

      <style>{`
        .animate-fade-in {
          animation: fadeIn 0.4s ease-out forwards;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
