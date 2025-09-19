// App.js

import React, { useState } from 'react';
import './App.css';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000';

const STORY_LENGTHS = {
  short: 5,
  medium: 8,
  long: 12,
};

function App() {
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

  // 重置所有状态到初始值的函式
  const resetStory = () => {
    setHasStarted(false); // 返回到初始页面
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

  // 处理页首「开启新故事」按钮的点击事件（带确认）
  const handleNewStoryClick = () => {
    if (window.confirm('您确定要放弃目前的故事，开始一个新的冒险吗？')) {
      resetStory();
    }
  };

  // 处理图片选择的函式
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // 移除已选图片的函式
  const handleRemoveImage = () => {
    setImagePreview('');
    setCharacter(''); 
    const fileInput = document.getElementById('character-image-upload');
    if (fileInput) {
        fileInput.value = null;
    }
  };

  // 开始故事的核心逻辑
  const handleStartStory = async (e) => {
    e.preventDefault();
    if ((inputMode === 'text' && !character) || (inputMode === 'image' && !imagePreview) || !setting) {
      alert('请提供主角（文字或图片）和故事场景！');
      return;
    }
    setIsLoading(true);
    setError(null);
    setStoryHistory([]);

    const steps = STORY_LENGTHS[storyLength];
    setTotalSteps(steps);
    setCurrentStep(1);
    
    const startPayload = {
      setting,
      total_steps: steps,
    };

    if (inputMode === 'image' && imagePreview) {
      startPayload.image_data_url = imagePreview;
      if (character.trim()) {
        startPayload.character = character;
      }
    } else {
      startPayload.character = character;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/start_story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startPayload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.detail || '网络请求失败';
        throw new Error(errorMessage);
      }
      const data = await response.json();
      setStory(data);
      setStoryHistory([data]);
    } catch (err) {
      setError(`无法开始故事：${err.message}。请检查后端服务。`);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // 故事下一步的核心逻辑
  const handleNextStep = async (payload) => {
    setIsLoading(true);
    setError(null);
    const nextStep = currentStep + 1;
    const bodyPayload = {
      ...payload,
      story_history: storyHistory,
      previous_image_url: story.image_url,
      current_step: nextStep,
      total_steps: totalSteps
    };

    try {
      const response = await fetch(`${API_BASE_URL}/next_step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok) {
          const errorData = await response.json();
          const errorMessage = errorData.detail?.detail?.[0]?.msg || errorData.detail || '网络请求失败';
          throw new Error(errorMessage);
      }
      const data = await response.json();
      setStory(data);
      setStoryHistory(prevHistory => [...prevHistory, data]);
      setCurrentStep(nextStep);
      setUserAction('');
    } catch (err) {
      setError(`无法继续故事：${err.message}。请检查后端服务。`);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // 处理选择项点击
  const handleChoiceClick = (choiceId) => {
    handleNextStep({ choice_id: choiceId });
  };

  // 处理自定义行动提交
  const handleUserActionSubmit = (e) => {
    e.preventDefault();
    if (!userAction.trim()) {
      alert('请输入你的行动！');
      return;
    }
    handleNextStep({ user_action: userAction });
  };

  const isStoryEnded = story && story.choices.length === 0;
  const isStartDisabled = isLoading || !setting.trim() || (inputMode === 'text' && !character.trim()) || (inputMode === 'image' && !imagePreview);

  return (
    <div className="App">
      {!hasStarted ? (
        // --- 这是新的初始页面视图 ---
        <div className="landing-page">
          <div className="storybook-cover">
            <h1 className="welcome-title">欢迎来到织梦坊</h1>
            <p className="welcome-text">
              在这里，每一个天马行空的想法，每一张心爱的照片，都能绽放成一篇独一无二的童话故事。
            </p>
            <p className="welcome-text">
              准备好了吗？让我们一起把想象力变成永恒的纪念。
            </p>
            <button onClick={() => setHasStarted(true)} className="start-experience-button">
              ✨ 开始体验 ✨
            </button>
          </div>
        </div>
      ) : (
        // --- 这是您原来熟悉的核心应用视图 ---
        <div className="story-creator-page">
          <header className="App-header">
            <h1>织梦坊 - 用AI把童言织成童话</h1>
            <div className="header-controls">
              {totalSteps > 0 && <h2>第 {currentStep} / {totalSteps} 幕</h2>}
              {story && !isStoryEnded && <button onClick={handleNewStoryClick} className="new-story-button">开启新故事</button>}
            </div>
          </header>

          <main className="App-main">
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
            ) : (
              <div className="story-container">
                {story.image_url && <img src={story.image_url} alt="故事情景" className="story-image" />}
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
            )}
            {isLoading && <div className="loading">正在加载下一段奇遇...</div>}
            {error && <div className="error">{error}</div>}
          </main>
        </div>
      )}
    </div>
  );
}

export default App;
