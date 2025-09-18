import os
import json
import re
import uuid
import asyncio
import base64 # [新增] 用于处理 Base64 图片数据
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, model_validator
from typing import List, Optional, Union # [修改] Union 用于更灵活的类型提示
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import time
from google import genai
from google.genai import types

from PIL import Image
from io import BytesIO
from fastapi.staticfiles import StaticFiles

load_dotenv()
os.makedirs("generated_images", exist_ok=True)
# --- 客户端设置 ---
google_api_key = os.getenv("GEMINI_API_KEY")
if not google_api_key:
    raise ValueError("GEMINI_API_KEY not found in .env file")
gemini_client = genai.Client(api_key=google_api_key)


# --- FastAPI 应用设置 ---
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
origins = [FRONTEND_URL]

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
BASE_URL = os.getenv("RENDER_EXTERNAL_URL", f"http://127.0.0.1:8000")

app.mount("/images", StaticFiles(directory="generated_images"), name="images")




IMAGE_CONSISTENCY_RULE = "you should maintain visual consistency for the main character based on the reference image provided. The character's appearance, features, clothing, and colors must be exactly the same. Now, generate the following scene:"


# --- 数据模型定义 ---
class StoryStartRequest(BaseModel):
    # 字段定义保持不变
    character: Optional[str] = None
    setting: str
    total_steps: int
    image_data_url: Optional[str] = None 

    # [修改] 调整校验器逻辑
    @model_validator(mode='before')
    @classmethod
    def check_character_or_image(cls, data):
        character_exists = 'character' in data and data['character'] is not None and data['character'].strip() != ""
        image_exists = 'image_data_url' in data and data['image_data_url'] is not None and data['image_data_url'].strip() != ""

        # [修改] 新的逻辑：两者不能都为空。但可以同时存在。
        if not character_exists and not image_exists:
            raise ValueError('必须提供 character 或 image_data_url 中的一个来指定故事主角。')
            
        return data

class StoryChoice(BaseModel):
    id: str
    text: str

class StoryResponse(BaseModel):
    text: str
    image_url: Optional[str] = None
    choices: List[StoryChoice]
    main_quest: str

class NextStepRequest(BaseModel):
    choice_id: Optional[str] = None
    user_action: Optional[str] = None
    story_history: List[StoryResponse]
    previous_image_url: Optional[str] = None
    current_step: int
    total_steps: int

    @model_validator(mode='before')
    @classmethod
    def check_choice_or_action(cls, data):
        choice_exists = 'choice_id' in data and data['choice_id'] is not None
        action_exists = 'user_action' in data and data['user_action'] is not None and data['user_action'].strip()
        if choice_exists and action_exists:
            raise ValueError('不能同时提供 choice_id 和 user_action')
        if not choice_exists and not action_exists:
            raise ValueError('必须提供 choice_id 或 user_action 中的一个')
        return data

# --- 工具函数 ---
# [新增] 将 Base64 字符串解码为 PIL Image 对象
def decode_base64_to_image(base64_string: str) -> Image.Image:
    # 移除 "data:image/png;base64," 或 "data:image/jpeg;base64," 等前缀
    if "," in base64_string:
        header, base64_data = base64_string.split(",", 1)
    else:
        base64_data = base64_string
    
    img_bytes = base64.b64decode(base64_data)
    return Image.open(BytesIO(img_bytes))

# --- 核心AI函数 ---
# [修改] 增加可选的 image_input 参数
def _blocking_generate_story_part(prompt: str, image_input: Optional[Image.Image] = None) -> str:
    system_prompt = """
    你是一个富有想象力的互动故事讲述者。你的任务是根据用户的【选择】或【自定义的行动】，继续编织一个引人入胜的故事。
    如果用户提供了一张图片，请你以图片中的主要物体（比如人物的照片、小动物、小玩具等）作为故事的主角。如果用户同时提供了主角名称，请将这个名称赋予图片中的主角。
    你的讲述对象是4-9岁的儿童。你必须用给小朋友讲故事的语气来创作。
    你的故事必须通俗易懂，适合小朋友阅读，不要出现复杂难懂的语言。
    你的故事中不能出现暴力、恐怖、血腥等不适宜的内容。你的语言必须是中文。
    你的故事最好具有教育意义。
    你的回答必须严格遵循一个 JSON 格式。这个 JSON 对象必须包含以下【四个】键：
    1. "text": (字符串) 故事的下一段描述，必须紧密衔接上文，并【体现用户行动的结果】。
    2. "image_prompt": (字符串) 一句英文的、详细描述性的、儿童插画风格的提示词(kids story book illustration style)，概括 "text" 中的场景，确保主角特征明确，并与图片中的主角保持一致。
    3. "choices": (数组) 一个包含两个故事选项的数组。每个选项都是一个对象，包含 "id" (A 或 B) 和 "text" (选项的描述文本)。
    4. "main_quest": (字符串) 必须是一个明确的、可执行的、贯穿整个故事的核心任务。例如：“帮助小松鼠奇奇找到回家的三颗魔法橡果”或“收集五种颜色的花瓣来治愈生病的精灵女王”。它必须是一个清晰的目标，而不是一个模糊的主题。
    不要在你的回答中包含任何解释或除了这个JSON对象之外的任何其他文本。
    """

    generation_config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        thinking_config=types.ThinkingConfig(thinking_budget=0)
    )

    # [修改] 根据是否有图片输入构建 contents
    contents: List[Union[str, Image.Image]] = []
    if image_input:
        contents.append(image_input)
    contents.append(prompt) # 用户prompt总是最后一个

    response = gemini_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=contents,
        config=generation_config
    )
    return response.text

# [修改] 增加可选的 image_input 参数
async def generate_story_part(prompt: str, image_input: Optional[Image.Image] = None) -> dict:
    try:
        response_text = await asyncio.to_thread(_blocking_generate_story_part, prompt, image_input)
        return json.loads(response_text)
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from Gemini response: {e}")
        print(f"Raw Gemini response: {response_text}")
        raise HTTPException(status_code=500, detail="AI response was not valid JSON.")
    except Exception as e:
        print(f"Error generating story part with Gemini: {e}")
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail="An unexpected error occurred with the Gemini service.")

# 图片生成函数（无变化，完全保留您的版本）
def _blocking_image_generation(prompt: str, previous_image: Optional[Image.Image] = None) -> bytes:
    contents = [prompt]
    if previous_image:
        contents.append(previous_image)
    
    max_retries = 3
    initial_delay = 2  # 初始延遲2秒

    for attempt in range(max_retries):
        try:
            # 嘗試呼叫 API
            response = gemini_client.models.generate_content(model="gemini-2.5-flash-image-preview", contents=contents)
            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    print(f"图片生成成功 (尝试第 {attempt + 1} 次)")
                    return part.inline_data.data
            raise ValueError("API虽成功但未返回图片数据")
        
        except Exception as e:
            print(f"图片生成失敗 (尝试第 {attempt + 1}/{max_retries} 次): {e}")
            if attempt < max_retries - 1:
                # 如果不是最後一次嘗試，則等待一段時間後重試
                delay = initial_delay * (2 ** attempt) # 指數退避：2s, 4s, 8s
                print(f"將在 {delay} 秒后重试...")
                time.sleep(delay)
            else:
                # 如果所有嘗試都失敗了，則將錯誤向上拋出
                print("所有重试均失敗，放弃生成图片。")
                raise e # 重新引發最後一次的異常

    raise ValueError("未能从API相应中获取图片数据，且重试机制异常结束")


# 图片生成异步包装器
async def generate_consistent_image(prompt: str, previous_image_url: Optional[str] = None, initial_image: Optional[Image.Image] = None) -> str:
    try:
        previous_image_object = initial_image
        if not previous_image_object and previous_image_url:
            local_image_path = os.path.join("generated_images", os.path.basename(previous_image_url))
            if os.path.exists(local_image_path):
                print(f"找到上一张图片: {local_image_path}，用于保持角色一致性。")
                previous_image_object = Image.open(local_image_path)
        
        image_data = await asyncio.to_thread(_blocking_image_generation, prompt, previous_image_object)
        
        image = Image.open(BytesIO(image_data))
        os.makedirs("generated_images", exist_ok=True)
        filename = f"{uuid.uuid4()}.png"
        save_path = os.path.join("generated_images", filename)
        image.save(save_path)
        
        image_url = f"{BASE_URL}/images/{filename}"
        print(f"新图片已生成并保存: {image_url}")
        return image_url
        
    except Exception as e:
        print(f"图片生成彻底失败: {e}")
        # [修改] 啟用新的回退策略
        if previous_image_url:
            print(f"启用连贯性回退策略：重复使用上一张图片 ({previous_image_url})")
            return previous_image_url
        else:
            # 如果是第一張圖就失敗了，那只能返回佔位圖
            print("故事第一张图生成失败，返回占位图。")
            return f"https://via.placeholder.com/512x512.png?text=Image+Generation+Failed"


# --- API 接口 ---
@app.post("/start_story", response_model=StoryResponse)
async def start_story(request: StoryStartRequest):
    print(f"收到新故事请求: 主角 {request.character if request.character else '[图片上传]'}, 场景 {request.setting}, 预计长度 {request.total_steps} 幕")
    
    image_input_for_gemini: Optional[Image.Image] = None
    initial_prompt_text: str
    
    if request.image_data_url:
        image_input_for_gemini = decode_base64_to_image(request.image_data_url)
        # [修改] 如果有图片，prompt 需要引导AI识别主角
        if request.character:
            initial_prompt_text = (
                f"这是一张用户上传的图片，请以图片中的主要物体或人物作为故事主角，并将主角命名为 '{request.character}'。"
                f"在 '{request.setting}' 场景下，为这个主角创作一个引人入胜的儿童故事开篇。"
                f"这个故事的总长度预计为【{request.total_steps}幕】。"
                f"请确保开篇能够建立一个清晰的主线任务，并为后续发展留下悬念。"
            )
        else:
            initial_prompt_text = (
                f"这是一张用户上传的图片，请以图片中的主要物体或人物作为故事主角。"
                f"在 '{request.setting}' 场景下，为这个主角创作一个引人入胜的儿童故事开篇。"
                f"这个故事的总长度预计为【{request.total_steps}幕】。"
                f"请确保开篇能够建立一个清晰的主线任务，并为后续发展留下悬念。"
            )
        
    else: # 纯文本开始
        initial_prompt_text = (
            f"请为一个关于主角 '{request.character}' 在 '{request.setting}' 场景下的儿童故事，创作一个引人入胜的开篇。"
            f"这个故事的总长度预计为【{request.total_steps}幕】。"
            f"请确保开篇能够建立一个清晰的主线任务，并为后续发展留下悬念。"
        )
    
    ai_data = await generate_story_part(initial_prompt_text, image_input_for_gemini)
    final_image_prompt = f"{IMAGE_CONSISTENCY_RULE} {ai_data['image_prompt']}"
    print(f"\n[AI 场景 Prompt]: {ai_data['image_prompt']}")
    print(f"[最终合成 Prompt]: {final_image_prompt}\n")
    
    generated_image_url = await generate_consistent_image(
        prompt=final_image_prompt, # 使用我们合成的、带规则的 prompt
        initial_image=image_input_for_gemini
    )
    
    return StoryResponse(
        text=ai_data["text"],
        image_url=generated_image_url,
        choices=[StoryChoice(**choice) for choice in ai_data["choices"]],
        main_quest=ai_data["main_quest"]
    )

@app.post("/next_step", response_model=StoryResponse)
async def next_step(request: NextStepRequest):
    print(f"收到下一步请求... 当前进度: {request.current_step}/{request.total_steps}")
    main_quest_line = request.story_history[0].main_quest if request.story_history else "继续探索"
    action_description_line = ""
    if request.user_action:
        print(f"用户自定义行动: '{request.user_action}'")
        action_description_line = f"接下来，主角决定自己行动，他/她想：'{request.user_action}'。"
    elif request.choice_id:
        print(f"用户选择选项: {request.choice_id}")
        user_choice_text = "继续"
        if request.story_history:
            last_part = request.story_history[-1]
            for choice in last_part.choices:
                if choice.id == request.choice_id:
                    user_choice_text = choice.text
                    break
        action_description_line = f"在故事的最新发展中，主角选择了选项：'{user_choice_text}'。"
    narrative_guidance = ""
    is_final_step = request.current_step == request.total_steps
    if is_final_step:
        narrative_guidance = (
            f"这是故事的【最后一幕】。故事的核心任务是：“{main_quest_line}”。\n"
            f"请你必须围绕这个核心任务，创作一个圆满、清晰的结局，确保主角最终完成了这个任务，并解决所有相关悬念。\n"
            f"在你的JSON回答中，\"choices\"字段必须是一个【空数组 `[]`】，因为故事已经结束。"
        )
    elif request.current_step >= request.total_steps * 0.75:
        narrative_guidance = (
            f"现在是故事的第【{request.current_step}/{request.total_steps}】幕，剧情已接近高潮。\n"
            "请创作一段紧张、关键的情节，将故事推向顶点，为最终解决主线任务做准备。"
        )
    else:
        narrative_guidance = (
            f"现在是故事的第【{request.current_step}/{request.total_steps}】幕，剧情正在发展阶段。\n"
            f"请创作一段承上启下的情节。最重要的是，这一步必须让主角在完成主线任务：“{main_quest_line}” 的道路上【取得明确的进展】。\n"
            "可以引入一个帮助解决主线的线索，或者克服一个通往主线的小障碍。"
        )
    story_context = "这是已经发生的故事梗概，请你续写：\n\n"
    for i, part in enumerate(request.story_history):
        story_context += f"第 {i+1} 幕: {part.text}\n"
    continuation_prompt = (
        f"{story_context}\n"
        f"{action_description_line}\n\n"
        f"--- 核心任务指令 (最重要！) ---\n"
        f"请始终围绕故事主线：“{main_quest_line}”。\n"
        f"--- 当前阶段叙事指令 ---\n"
        f"{narrative_guidance}"
    )
    print(f"--- 发送给AI的最终Prompt ---\n{continuation_prompt}\n--------------------------")
    ai_data = await generate_story_part(continuation_prompt)
    if is_final_step:
        ai_data["choices"] = []
    final_image_prompt = f"{IMAGE_CONSISTENCY_RULE} {ai_data['image_prompt']}"
    print(f"\n[AI 场景 Prompt]: {ai_data['image_prompt']}")
    print(f"[最终合成 Prompt]: {final_image_prompt}\n")
    
    generated_image_url = await generate_consistent_image(
        prompt=final_image_prompt, # 使用我们合成的、带规则的 prompt
        previous_image_url=request.previous_image_url
    )
    
    main_quest_line = request.story_history[0].main_quest if request.story_history else "继续探索"

    return StoryResponse(
        text=ai_data["text"],
        image_url=generated_image_url,
        choices=[StoryChoice(**choice) for choice in ai_data["choices"]],
        main_quest=main_quest_line
    )
