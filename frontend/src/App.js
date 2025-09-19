// App.js

import React, { useState, useRef, useEffect } from 'react';
import './App.css';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000';

const STORY_LENGTHS = {
  short: 5,
  medium: 8,
  long: 12,
};

const dailyAdventures = [
  { character: '一只想当宇航员的小刺猬', setting: '在它的蔬菜园里' },
  { character: '一个害羞的喷火龙宝宝', setting: '在一座由糖果搭建的城堡里' },
  { character: '一位能听懂动物说话的公主', setting: '在繁华的现代都市' },
  { character: '一个用旧袜子做成的机器人', setting: '在一艘深海潜水艇中' },
  { character: '一只总是找不到回家路的小幽灵', setting: '在一座巨大的图书馆里' },
  { character: '一个掌管梦境的精灵', setting: '在一个孩子的枕头下面' },
];

function App() {
  // --- 状态管理 ---
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [character, setCharacter] = useState('');
  const [setting, setSetting] = useState('');
  const [storyLength, setStoryLength] = useState('short');
  const [totalSteps, setTotalSteps] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [userAction, setUserAction] = useState('');
  const [story, setStory] = useState(null);
  const [storyHistory, setStoryHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [inputMode, setInputMode] = useState('text');
  const [imagePreview, setImagePreview] = useState('');
  const [isImageLoading, setIsImageLoading] = useState(false);

  // --- 音乐控制 ---
  const togglePlayPause = () => {
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };
  
  useEffect(() => {
    if (hasStarted && audioRef.current) {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(error => {
        console.log("浏览器阻止了自动播放:", error);
        setIsPlaying(false);
      });
    }
  }, [hasStarted]);

  // --- 核心逻辑函数 ---
  const resetStory = () => {
    setHasStarted(false);
    setStory(null);
    setStoryHistory([]);
    setCharacter('');
    setSetting('');
    setStoryLength('short');
    setTotalSteps(0);
    setCurrentStep(0);
    setUserAction('');
    setError(null);
    setInputMode('text');
    setImagePreview('');
    const fileInput = document.getElementById('character-image-upload');
    if (fileInput) {
      fileInput.value = null;
    }
  };

  const handleNewStoryClick = () => {
    if (window.confirm('您确定要放弃目前的故事，开始一个新的冒险吗？')) {
      resetStory();
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => { setImagePreview(reader.result); };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setImagePreview('');
    setCharacter('');
    const fileInput = document.getElementById('character-image-upload');
    if (fileInput) { fileInput.value = null; }
  };

  const startStoryFlow = async (startParams) => {
    setIsLoading(true);
    setIsImageLoading(true);
    setError(null);
    setStoryHistory([]);

    const steps = STORY_LENGTHS[startParams.storyLength || 'medium'];
    setTotalSteps(steps);
    setCurrentStep(1);

    const startPayload = {
      setting: startParams.setting,
      total_steps: steps,
    };
    if (startParams.imageDataUrl) {
      startPayload.image_data_url = startParams.imageDataUrl;
      if (startParams.character && startParams.character.trim()) {
        startPayload.character = startParams.character;
      }
    } else {
      startPayload.character = startParams.character;
    }

    try {
      const textResponse = await fetch(`${API_BASE_URL}/start_story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startPayload),
      });
      if (!textResponse.ok) {
        const errorData = await textResponse.json();
        throw new Error(errorData.detail || '获取故事文本失败');
      }
      const textData = await textResponse.json();

      const newStoryPart = { ...textData, image_url: null };
      setStory(newStoryPart);
      setStoryHistory([newStoryPart]);
      setHasStarted(true);
      setIsLoading(false);

      const imagePayload = {
        image_prompt: textData.image_prompt,
        initial_image_data_url: startParams.imageDataUrl,
      };

      const imageResponse = await fetch(`${API_BASE_URL}/generate_image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imagePayload),
      });
      if (!imageResponse.ok) {
        throw new Error('图片生成失败');
      }
      const imageData = await imageResponse.json();

      const finalStoryPart = { ...newStoryPart, image_url: imageData.image_url };
      setStory(finalStoryPart);
      setStoryHistory([finalStoryPart]);

    } catch (err) {
      setError(`无法开始故事：${err.message}。请检查后端服务。`);
      console.error(err);
      setHasStarted(false);
      setIsLoading(false);
    } finally {
      setIsImageLoading(false);
    }
  };
  
  const handleStartStory = (e) => {
    e.preventDefault();
    if ((inputMode === 'text' && !character) || (inputMode === 'image' && !imagePreview) || !setting) {
      alert('请提供主角（文字或图片）和故事情景！');
      return;
    }
    startStoryFlow({
      character,
      setting,
      storyLength,
      imageDataUrl: imagePreview,
    });
  };

  const handleDailyAdventure = () => {
    const randomAdventure = dailyAdventures[Math.floor(Math.random() * dailyAdventures.length)];
    startStoryFlow({
      character: randomAdventure.character,
      setting: randomAdventure.setting,
      storyLength: 'medium',
    });
  };

  const handleNextStep = async (payload) => {
    setIsLoading(true);
    setIsImageLoading(true);
    setError(null);
    const nextStep = currentStep + 1;

    const textPayload = {
      ...payload,
      story_history: storyHistory,
      current_step: nextStep,
      total_steps: totalSteps
    };

    try {
      const textResponse = await fetch(`${API_BASE_URL}/next_step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(textPayload),
      });
      if (!textResponse.ok) {
        const errorData = await textResponse.json();
        throw new Error(errorData.detail?.detail?.[0]?.msg || errorData.detail || '获取故事文本失败');
      }
      const textData = await textResponse.json();

      const newStoryPart = { ...textData, image_url: null };
      setStory(newStoryPart);
      const newHistory = [...storyHistory, newStoryPart];
      setStoryHistory(newHistory);
      setCurrentStep(nextStep);
      setUserAction('');
      setIsLoading(false);

      const imagePayload = {
        image_prompt: textData.image_prompt,
        previous_image_url: story.image_url,
      };

      const imageResponse = await fetch(`${API_BASE_URL}/generate_image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imagePayload),
      });
      if (!imageResponse.ok) {
        throw new Error('图片生成失败');
      }
      const imageData = await imageResponse.json();

      const finalStoryPart = { ...newStoryPart, image_url: imageData.image_url };
      setStory(finalStoryPart);
      const finalHistory = [...storyHistory, finalStoryPart];
      setStoryHistory(finalHistory);

    } catch (err) {
      setError(`无法继续故事：${err.message}。`);
      console.error(err);
      setIsLoading(false);
    } finally {
      setIsImageLoading(false);
    }
  };

  const handleChoiceClick = (choiceId) => { handleNextStep({ choice_id: choiceId }); };
  const handleUserActionSubmit = (e) => {
    e.preventDefault();
    if (!userAction.trim()) { alert('请输入你的行动！'); return; }
    handleNextStep({ user_action: userAction });
  };

  const isStoryEnded = story && story.choices.length === 0;
  const isStartDisabled = isLoading || !setting.trim() || (inputMode === 'text' && !character.trim()) || (inputMode === 'image' && !imagePreview);

  // --- 渲染 JSX ---
  return (
    <div className="App">
      <audio ref={audioRef} src="/music/bgm1.mp3" loop />
      
      {isLoading && (
        <div className="loading-overlay">
          {story ? "正在加载下一段奇遇..." : "正在构思奇遇..."}
        </div>
      )}

      {!hasStarted ? (
        <div className="landing-page">
          <div className="storybook-cover">
            <h1 className="welcome-title">欢迎来到织梦坊</h1>
            <p className="welcome-text">
              在这里，每一个天马行空的想法，每一张心爱的照片，都能绽放成一篇独一无二的童话故事。
            </p>
            <div className="start-buttons-container">
              <button onClick={() => setHasStarted(true)} className="start-experience-button">
                ✨ 自定义故事 ✨
              </button>
              <button onClick={handleDailyAdventure} className="daily-adventure-button">
                🚀 每日奇遇 🚀
              </button>
            </div>
            <p className="producer-credit-landing">制作人：禅川</p>
          </div>
        </div>
      ) : (
        <div className="story-creator-page">
          <header className="App-header">
            <h1>织梦坊 - 用AI把童言织成童话</h1>
            <div className="header-controls">
              {totalSteps > 0 && <h2>第 {currentStep} / {totalSteps} 幕</h2>}
              {story && !isStoryEnded && <button onClick={handleNewStoryClick} className="new-story-button">开启新故事</button>}
            </div>
            <button onClick={togglePlayPause} className="music-toggle-button">
              {isPlaying ? '暂停音乐 ⏸️' : '播放音乐 🎵'}
            </button>
          </header>

          <main className="App-main">
            {/* [重大修正] 重新加入初始表单的渲染逻辑 */}
            {!story ? (
              <form onSubmit={handleStartStory} className="start-form">
                <div className="character-choice-tabs">
                    <button type="button" className={inputMode === 'text' ? 'active' : ''} onClick={() => setInputMode('text')}>文字输入主角</button>
                    <button type="button" className={inputMode === 'image' ? 'active' : ''} onClick={() => setInputMode('image')}>上传图片主角</button>
                </div>
                {inputMode === 'text' ? (
                    <input type="text" value={character} onChange={(e) => { setCharacter(e.target.value); if (imagePreview) setImagePreview(''); }} placeholder="故事的主角是..." />
                ) : (
                    <div className="image-upload-wrapper">
                        <div className="image-upload-container">
                            {imagePreview ? (
                                <div className="image-preview-wrapper">
                                    <img src={imagePreview} alt="主角预览" className="image-preview" />
                                    <button type="button" onClick={handleRemoveImage} className="remove-image-btn">×</button>
                                </div>
                            ) : (
                                <label htmlFor="character-image-upload" className="image-upload-label">点击选择图片</label>
                            )}
                            <input id="character-image-upload" type="file" accept="image/png, image/jpeg, image/webp" onChange={handleImageChange} style={{ display: 'none' }} />
                        </div>
                        {imagePreview && (
                            <input type="text" className="optional-name-input" value={character} onChange={(e) => setCharacter(e.target.value)} placeholder="给你的主角起个名字（选填）" />
                        )}
                    </div>
                )}
                <input type="text" value={setting} onChange={(e) => setSetting(e.target.value)} placeholder="故事发生在哪里..." />
                <div className="length-selector">
                    <label><input type="radio" value="short" checked={storyLength === 'short'} onChange={(e) => setStoryLength(e.target.value)} /> 短篇</label>
                    <label><input type="radio" value="medium" checked={storyLength === 'medium'} onChange={(e) => setStoryLength(e.target.value)} /> 中篇</label>
                    <label><input type="radio" value="long" checked={storyLength === 'long'} onChange={(e) => setStoryLength(e.target.value)} /> 长篇</label>
                </div>
                <button type="submit" disabled={isStartDisabled}>{isLoading ? '正在构思...' : '开始我们的故事'}</button>
              </form>
            ) : null }
            
            {story ? (
              <div className="story-container">
                <div className="story-image-container">
                  {isImageLoading ? (
                    <div className="image-placeholder">
                      <div className="loader-spinner"></div>
                      <p>织梦中...</p>
                    </div>
                  ) : (
                    story.image_url && <img src={story.image_url} alt="故事情景" className="story-image" />
                  )}
                </div>
                <div className="story-text-container">
                    <p className="story-text">{story.text}</p>
                    {isStoryEnded ? (
                    <div className="story-ending">
                        <p>~ 故事完结 ~</p>
                        <button onClick={resetStory} className="restart-button">
                        开启新的冒险
                        </button>
                    </div>
                    ) : (
                    <div className="action-wrapper">
                        <div className="choices-container">
                            {story.choices.map((choice) => (
                                <button key={choice.id} onClick={() => handleChoiceClick(choice.id)} disabled={isLoading} className="choice-button">{choice.text}</button>
                            ))}
                        </div>
                        <div className="or-separator">或者...</div>
                        <form onSubmit={handleUserActionSubmit} className="user-action-form">
                            <input type="text" value={userAction} onChange={(e) => setUserAction(e.target.value)} placeholder="你想让主角做什么？" disabled={isLoading} className="user-action-input" />
                            <button type="submit" disabled={isLoading} className="user-action-button">确定</button>
                        </form>
                    </div>
                    )}
                </div>
              </div>
            ) : null }

            {error && <div className="error">{error}</div>}
          </main>
        </div>
      )}
      <footer className="persistent-footer">
        <p>制作人：禅川</p>
      </footer>
    </div>
  );
}

export default App;
