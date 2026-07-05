import './style.css';
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// ==========================================
// 1. 全局配置与状态
// ==========================================
let isEmoMode = false;
let isMuted = true;

// 音频系统状态
let audioCtx = null;
let bgMusicInterval = null;
let noteIndex = 0;

// Canvas 状态 (Emoji流星雨)
const canvas = document.getElementById('meteor-canvas');
const ctx = canvas.getContext('2d');
let meteors = [];
let sparks = [];
let mouse = { x: -1000, y: -1000 };
let lastTime = 0;
let fps = 60;

// "拒绝"按钮逃跑计数
let noBtnDodgeCount = 0;

// ==========================================
// MediaPipe 情绪识别状态
// ==========================================
let faceLandmarker = null;
let faceLandmarkerLoaded = false;
let studioDetectionAnimId = null;
let lastStudioProcessTime = 0;
let lastStudioFaceData = null;
let studioShowMesh = true;
let vhsShowMesh = true;

const STUDIO_EMOTION_MAP = {
  happy: { emoji: '😊', name: '开心', color: '#10b981' },
  sad: { emoji: '😢', name: '悲伤', color: '#3b82f6' },
  angry: { emoji: '😠', name: '愤怒', color: '#ef4444' },
  surprise: { emoji: '😲', name: '惊讶', color: '#f59e0b' },
  fear: { emoji: '😨', name: '恐惧', color: '#8b5cf6' },
  disgust: { emoji: '🤢', name: '厌恶', color: '#a855f7' },
  neutral: { emoji: '😐', name: '中性', color: '#6b7280' }
};

const STUDIO_LEFT_EYE_INDICES = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const STUDIO_RIGHT_EYE_INDICES = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const STUDIO_LIPS_OUTER_INDICES = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 95];
const STUDIO_LEFT_EYEBROW_INDICES = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const STUDIO_RIGHT_EYEBROW_INDICES = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

// ==========================================
// 2. Web Audio API 8-Bit 音效合成引擎
// ==========================================

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// 播放基础音符
function playChiptuneNote(freq, startTime, duration, type = 'triangle', volume = 0.15) {
  if (!audioCtx || isMuted) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = type;
  
  const actualStartTime = startTime !== null && startTime !== undefined ? startTime : audioCtx.currentTime;
  osc.frequency.setValueAtTime(freq, actualStartTime);

  gainNode.gain.setValueAtTime(volume, actualStartTime);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, actualStartTime + duration);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  osc.start(actualStartTime);
  osc.stop(actualStartTime + duration);
}

// 打字机滴答声
function playTypewriterTick() {
  playChiptuneNote(800 + Math.random() * 400, null, 0.03, 'sine', 0.02);
}

// 爆炸声 (Pop)
function playPopSound() {
  if (!audioCtx || isMuted) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(350, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.18);

  gainNode.gain.setValueAtTime(0.08, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.18);
}

// 照相快门声 (Shutter Synth)
function playShutterSound() {
  if (!audioCtx || isMuted) return;
  const now = audioCtx.currentTime;
  
  // 模拟相机反光板动作: 高频金属擦声 + 低频机械声
  playChiptuneNote(1000, now, 0.05, 'triangle', 0.2);
  playChiptuneNote(100, now + 0.03, 0.15, 'sawtooth', 0.25);
  
  // 加上一小段白噪点模拟快门机械卷带
  const bufferSize = audioCtx.sampleRate * 0.1;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noiseNode = audioCtx.createBufferSource();
  noiseNode.buffer = buffer;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.08, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  noiseNode.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noiseNode.start(now);
}

// 背景音乐旋律
const happyMelody = [
  261.63, 293.66, 329.63, 392.00, 440.00, 392.00, 329.63, 293.66,
  329.63, 349.23, 392.00, 523.25, 440.00, 392.00, 349.23, 329.63
];
const sadMelody = [
  220.00, 261.63, 329.63, 440.00, 392.00, 329.63, 261.63, 220.00,
  174.61, 220.00, 261.63, 349.23, 329.63, 261.63, 220.00, 196.00
];

function startBgMusic() {
  if (bgMusicInterval) clearInterval(bgMusicInterval);
  
  bgMusicInterval = setInterval(() => {
    if (!audioCtx || isMuted) return;
    const now = audioCtx.currentTime;
    const melody = isEmoMode ? sadMelody : happyMelody;
    const freq = melody[noteIndex % melody.length];
    
    const finalFreq = isEmoMode ? freq * 0.8 : freq;
    const duration = isEmoMode ? 0.35 : 0.25;
    
    playChiptuneNote(finalFreq, now, duration, isEmoMode ? 'triangle' : 'sine', 0.08);
    noteIndex++;
  }, isEmoMode ? 400 : 250);
}

function stopBgMusic() {
  if (bgMusicInterval) {
    clearInterval(bgMusicInterval);
    bgMusicInterval = null;
  }
}

// ==========================================
// 3. Canvas 互动 Emoji 流星雨引擎
// ==========================================

class EmojiMeteor {
  constructor(isEmo) {
    this.isEmo = isEmo;
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
    this.reset(true);
  }

  reset(initial = false) {
    this.size = Math.random() * 20 + 20;
    
    if (initial) {
      this.x = Math.random() * (canvas.width + 200);
      this.y = Math.random() * canvas.height - 100;
    } else {
      this.x = Math.random() * (canvas.width + 200) - 100;
      this.y = -50;
    }

    this.vx = -(Math.random() * 3 + 2);
    this.vy = Math.random() * 3 + 2;
    
    const normalEmojis = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😋', '😜', '😎', '🥳', '😏', '🤤'];
    const emoEmojis = ['😭', '😢', '😔', '🥺', '😓', '☹️', '😩', '😫', '😰', '🫠', '🤕', '🤒', '😱', '🫨', '🥱', '😴', '😑', '😐', '😬'];
    
    const list = this.isEmo ? emoEmojis : normalEmojis;
    this.emoji = list[Math.floor(Math.random() * list.length)];
    
    this.trail = [];
    this.angle = Math.random() * Math.PI * 2;
    this.spin = (Math.random() - 0.5) * 0.04;

    this.prepareOffscreenCanvas();
  }

  prepareOffscreenCanvas() {
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
    
    const pad = 15;
    const canvasSize = Math.ceil(this.size * 1.5 + pad * 2);
    this.offscreenCanvas.width = canvasSize;
    this.offscreenCanvas.height = canvasSize;
    
    const octx = this.offscreenCtx;
    octx.clearRect(0, 0, canvasSize, canvasSize);
    
    octx.save();
    octx.font = `${this.size}px sans-serif`;
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    
    octx.shadowBlur = 10;
    octx.shadowColor = this.isEmo ? '#f97316' : '#eab308';
    
    octx.fillText(this.emoji, canvasSize / 2, canvasSize / 2);
    octx.restore();
  }

  update() {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 8) {
      this.trail.shift();
    }

    this.x += this.vx;
    this.y += this.vy;
    this.angle += this.spin;

    const dx = this.x - mouse.x;
    const dy = this.y - mouse.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < 10000) {
      const dist = Math.sqrt(distSq);
      const force = (100 - dist) / 100;
      this.x += (dx / dist) * force * 6;
      this.y += (dy / dist) * force * 6;
    }

    if (this.y > canvas.height + 50 || this.x < -50) {
      this.reset(false);
    }
  }

  draw() {
    if (this.trail.length > 1) {
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < this.trail.length; i++) {
        const point = this.trail[i];
        const pct = i / this.trail.length;
        ctx.strokeStyle = this.isEmo 
          ? `rgba(249, 115, 22, ${pct * 0.25})` 
          : `rgba(234, 179, 8, ${pct * 0.25})`;
        ctx.lineWidth = (this.size * pct) / 2.5;
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    }

    if (this.offscreenCanvas) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      const halfSize = this.offscreenCanvas.width / 2;
      ctx.drawImage(this.offscreenCanvas, -halfSize, -halfSize);
      ctx.restore();
    }
  }
}

class Spark {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 8;
    this.vy = (Math.random() - 0.5) * 8 - 2;
    this.size = Math.random() * 4 + 2;
    this.color = color;
    this.alpha = 1;
    this.decay = Math.random() * 0.02 + 0.015;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.15;
    this.alpha -= this.decay;
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 4;
    ctx.shadowColor = this.color;
    ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.restore();
  }
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initMeteors();
}

function initMeteors() {
  meteors = [];
  const count = isEmoMode ? 140 : 60; // 极高密度
  for (let i = 0; i < count; i++) {
    meteors.push(new EmojiMeteor(isEmoMode));
  }
  document.getElementById('meteor-count').textContent = count;
}

let fpsUpdateCounter = 0;

function updateCanvas(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const elapsed = timestamp - lastTime;
  lastTime = timestamp;
  fps = Math.round(1000 / (elapsed || 1));
  
  fpsUpdateCounter++;
  if (fpsUpdateCounter >= 30) {
    document.getElementById('fps-val').textContent = fps;
    fpsUpdateCounter = 0;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  meteors.forEach(m => {
    m.update();
    m.draw();
  });

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.update();
    if (s.alpha <= 0) {
      sparks.splice(i, 1);
    } else {
      s.draw();
    }
  }

  requestAnimationFrame(updateCanvas);
}

function triggerExplosion(x, y) {
  const color = isEmoMode ? '#f97316' : '#eab308';
  for (let i = 0; i < 15; i++) {
    sparks.push(new Spark(x, y, color));
  }
  playPopSound();
}

function checkMeteorClick(x, y) {
  let hit = false;
  for (let i = 0; i < meteors.length; i++) {
    const m = meteors[i];
    const dx = m.x - x;
    const dy = m.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < m.size) {
      triggerExplosion(m.x, m.y);
      m.reset();
      hit = true;
      break;
    }
  }
  
  if (!hit) {
    const color = isEmoMode ? '#f97316' : '#eab308';
    for (let i = 0; i < 4; i++) {
      sparks.push(new Spark(x, y, color));
    }
  }
}

// ==========================================
// 4. 打字机与逃跑按钮逻辑
// ==========================================

const typingTextElement = document.getElementById('typing-text');
const askButtons = document.getElementById('ask-buttons');

function typeSentence(text, speed = 120, callback) {
  let index = 0;
  typingTextElement.textContent = '';
  askButtons.classList.add('hide');

  function typeChar() {
    if (index < text.length) {
      typingTextElement.textContent += text.charAt(index);
      playTypewriterTick();
      index++;
      setTimeout(typeChar, speed + (Math.random() - 0.5) * 40);
    } else if (callback) {
      callback();
    }
  }

  typeChar();
}

const btnNo = document.getElementById('btn-no');
const consoleBox = document.getElementById('console-box');
const marqueeText = document.getElementById('marquee-text');

function dodgeButton(e) {
  noBtnDodgeCount++;
  
  if (btnNo.style.position !== 'absolute') {
    btnNo.style.position = 'absolute';
    btnNo.style.margin = '0';
    btnNo.style.transition = 'left 0.15s cubic-bezier(0.25, 0.8, 0.25, 1), top 0.15s cubic-bezier(0.25, 0.8, 0.25, 1)';
  }

  const boxRect = consoleBox.getBoundingClientRect();
  const btnRect = btnNo.getBoundingClientRect();
  
  const padding = 15;
  const maxX = Math.max(0, boxRect.width - btnRect.width - padding * 2);
  const maxY = Math.max(0, boxRect.height - btnRect.height - padding * 2);
  
  const left = Math.random() * maxX + padding;
  const top = Math.random() * maxY + padding;
  
  btnNo.style.left = `${left}px`;
  btnNo.style.top = `${top}px`;
  btnNo.style.transform = 'none';
  
  playChiptuneNote(440 + noBtnDodgeCount * 100, null, 0.05, 'square', 0.06);

  if (noBtnDodgeCount === 1) {
    marqueeText.textContent = "警告：检测到违规乐观情绪！逃避按钮已启动自我防御机制！";
  } else if (noBtnDodgeCount === 2) {
    marqueeText.textContent = "拒绝？没门！悲伤是生命的底色，乖乖向 Emo 投降吧！";
  } else if (noBtnDodgeCount === 3) {
    marqueeText.textContent = "别点我了，差一点点就点到了！你是不是觉得自己特别执着？";
  } else if (noBtnDodgeCount === 4) {
    marqueeText.textContent = "系统已进入防皮防御状态。你越开心，我逃得越快。";
  } else if (noBtnDodgeCount >= 5) {
    marqueeText.textContent = "错误 502：强颜欢笑模块彻底崩溃。系统正准备自动逮捕您！";
    
    btnNo.removeEventListener('mouseover', dodgeButton);
    btnNo.style.transform = 'none';
    btnNo.style.left = '';
    btnNo.style.top = '';
    btnNo.style.position = '';
    btnNo.style.margin = '';
    btnNo.querySelector('.btn-text').textContent = '好吧，我投降 (伪) 🤡';
  }
}

function initNoButtonGag() {
  btnNo.addEventListener('mouseover', dodgeButton);
  
  btnNo.addEventListener('click', () => {
    playChiptuneNote(150, null, 0.4, 'sawtooth', 0.15);
    marqueeText.textContent = "系统严重警告：捕获到伪装开心份子！立刻强制执行 Emo 灵魂诊断！";
    
    btnNo.style.pointerEvents = 'none';
    typingTextElement.textContent = "⚠️ 强颜欢笑检测失败！\n即将启动强制审查程序...";
    typingTextElement.style.color = 'var(--color-pink)';
    
    setTimeout(() => {
      enterSelectMode();
    }, 1500);
  });
}

// ==========================================
// 5. 情绪照相馆 (Polaroid Studio) 核心逻辑
// ==========================================

let studioStream = null;
let snapImage = null; // 存储快照 Image 对象或 canvas
let activeSticker = null;
let stickerIdCounter = 0;

const studioVideo = document.getElementById('studio-video');
const studioCanvas = document.getElementById('studio-canvas');
const sCtx = studioCanvas.getContext('2d');
const btnCamToggle = document.getElementById('btn-studio-camera-toggle');
const btnSnap = document.getElementById('btn-studio-snap');
const stickerTraySection = document.getElementById('sticker-tray-section');

// ==========================================
// MediaPipe 情绪识别相关函数
// ==========================================

async function initStudioMediaPipe() {
  if (faceLandmarkerLoaded) return;
  
  try {
    console.log('[Studio MediaPipe] 开始初始化...');
    marqueeText.textContent = "正在加载情绪识别模型...";
    
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
    );
    console.log('[Studio MediaPipe] 视觉引擎加载完成');
    
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      runningMode: "VIDEO",
      numFaces: 1
    });
    
    faceLandmarkerLoaded = true;
    console.log('[Studio MediaPipe] 人脸模型加载完成');
    marqueeText.textContent = "情绪识别模型加载完毕，摄像头已就绪！";
  } catch (err) {
    console.error("[Studio MediaPipe] 加载失败:", err);
    marqueeText.textContent = "情绪模型加载失败，将使用基础模式。";
  }
}

function classifyEmotionsFromBlendshapes(b) {
  const get = (key) => b[key] || 0;
  
  const smile = (get('mouthSmileLeft') + get('mouthSmileRight')) / 2;
  const cheekSquint = (get('cheekSquintLeft') + get('cheekSquintRight')) / 2;
  let happy = Math.max(smile * 1.4, cheekSquint * 1.1);
  
  const mouthFrown = (get('mouthFrownLeft') + get('mouthFrownRight')) / 2;
  const browInnerUp = get('browInnerUp');
  const mouthShrugLower = get('mouthShrugLower');
  let sad = Math.max(
    mouthFrown * 1.5,
    browInnerUp * 1.3,
    (mouthFrown * 0.6 + browInnerUp * 0.6 + mouthShrugLower * 0.3)
  );
  
  const browDown = (get('browDownLeft') + get('browDownRight')) / 2;
  const mouthPress = (get('mouthPressLeft') + get('mouthPressRight')) / 2;
  const eyeSquint = (get('eyeSquintLeft') + get('eyeSquintRight')) / 2;
  const noseSneer = (get('noseSneerLeft') + get('noseSneerRight')) / 2;
  let angry = Math.max(
    browDown * 1.4,
    mouthPress * 1.2,
    (browDown * 0.7 + eyeSquint * 0.4 + noseSneer * 0.4)
  );
  
  const jawOpen = get('jawOpen');
  const browUp = ((get('browOuterUpLeft') + get('browOuterUpRight')) / 2 + get('browInnerUp')) / 2;
  const eyeWide = (get('eyeWideLeft') + get('eyeWideRight')) / 2;
  let surprise = Math.max(
    jawOpen * 1.5,
    browUp * 1.3,
    eyeWide * 1.3
  );
  
  const mouthStretch = (get('mouthStretchLeft') + get('mouthStretchRight')) / 2;
  let fear = Math.max(
    (browInnerUp * 0.6 + eyeWide * 0.6),
    mouthStretch * 1.4,
    (eyeWide * 0.7 + mouthStretch * 0.7)
  );
  
  const mouthUpperUp = (get('mouthUpperUpLeft') + get('mouthUpperUpRight')) / 2;
  const mouthSneer = (get('mouthSneerLeft') + get('mouthSneerRight')) / 2;
  let disgust = Math.max(
    noseSneer * 1.6,
    mouthSneer * 1.3,
    mouthUpperUp * 1.3
  );
  
  const activeSum = Math.max(happy, sad, angry, surprise, fear, disgust);
  let neutral = Math.max(0.0, 1.0 - activeSum * 2.2);
  
  const raw = { happy, sad, angry, surprise, fear, disgust, neutral };
  
  const expScores = {};
  let sumExp = 0;
  Object.keys(raw).forEach(key => {
    expScores[key] = Math.exp(raw[key] * 5.0);
    sumExp += expScores[key];
  });
  
  const finalScores = {};
  Object.keys(raw).forEach(key => {
    finalScores[key] = expScores[key] / sumExp;
  });
  
  return finalScores;
}

function getVideoDisplayTransform(videoEl, canvasEl) {
  const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
  const canvasRatio = canvasEl.width / canvasEl.height;
  
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  
  if (videoRatio > canvasRatio) {
    scale = canvasEl.height / videoEl.videoHeight;
    const scaledWidth = videoEl.videoWidth * scale;
    offsetX = (scaledWidth - canvasEl.width) / 2;
  } else {
    scale = canvasEl.width / videoEl.videoWidth;
    const scaledHeight = videoEl.videoHeight * scale;
    offsetY = (scaledHeight - canvasEl.height) / 2;
  }
  
  return { scale, offsetX, offsetY };
}

function drawStudioMesh(ctx, landmarks, emotion, canvasW, canvasH) {
  const color = STUDIO_EMOTION_MAP[emotion]?.color || '#6366f1';
  
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  
  drawStudioIndicesPath(ctx, landmarks, STUDIO_LEFT_EYE_INDICES, color, true, canvasW, canvasH);
  drawStudioIndicesPath(ctx, landmarks, STUDIO_RIGHT_EYE_INDICES, color, true, canvasW, canvasH);
  drawStudioIndicesPath(ctx, landmarks, STUDIO_LIPS_OUTER_INDICES, color, true, canvasW, canvasH);
  drawStudioIndicesPath(ctx, landmarks, STUDIO_LEFT_EYEBROW_INDICES, color, false, canvasW, canvasH);
  drawStudioIndicesPath(ctx, landmarks, STUDIO_RIGHT_EYEBROW_INDICES, color, false, canvasW, canvasH);
  
  landmarks.forEach((pt, idx) => {
    if (idx % 6 !== 0) return;
    
    const x = pt.x * canvasW;
    const y = pt.y * canvasH;
    
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

function drawStudioIndicesPath(ctx, landmarks, indices, color, closeLoop, canvasW, canvasH) {
  if (indices.length === 0) return;
  
  ctx.strokeStyle = color;
  ctx.beginPath();
  
  const startPt = landmarks[indices[0]];
  const startX = startPt.x * canvasW;
  const startY = startPt.y * canvasH;
  ctx.moveTo(startX, startY);
  
  for (let i = 1; i < indices.length; i++) {
    const pt = landmarks[indices[i]];
    const x = pt.x * canvasW;
    const y = pt.y * canvasH;
    ctx.lineTo(x, y);
  }
  
  if (closeLoop) {
    ctx.closePath();
  }
  ctx.stroke();
}

function updateStudioEmotionPanel(emotions) {
  const emoKeys = ['happy', 'sad', 'angry', 'surprise', 'fear', 'disgust', 'neutral'];
  
  emoKeys.forEach(key => {
    const val = emotions[key] || 0;
    const pct = Math.round(val * 100);
    const pctText = `${pct}%`;
    
    const valEl = document.getElementById(`val-${key}`);
    const barEl = document.getElementById(`bar-${key}`);
    
    if (valEl) valEl.textContent = pctText;
    if (barEl) barEl.style.width = pctText;
  });
  
  const dominantEmotion = Object.keys(emotions).reduce((a, b) => emotions[a] > emotions[b] ? a : b);
  const activeRow = document.querySelector(`.emotion-bar-row[data-emotion="${dominantEmotion}"]`);
  if (activeRow) {
    activeRow.classList.add('bar-row-pulse');
    setTimeout(() => activeRow.classList.remove('bar-row-pulse'), 400);
  }
}

function drawStudioFaceBox(ctx, faceData, canvasW, canvasH) {
  if (!faceData || !faceData.landmarks) return;
  
  const landmarks = faceData.landmarks;
  const emotions = faceData.emotions;
  const dominantEmotion = faceData.dominantEmotion;
  const dominantScore = faceData.dominantScore;
  
  const color = STUDIO_EMOTION_MAP[dominantEmotion]?.color || '#6366f1';
  const emoji = STUDIO_EMOTION_MAP[dominantEmotion]?.emoji || '😐';
  const name = STUDIO_EMOTION_MAP[dominantEmotion]?.name || dominantEmotion;
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  landmarks.forEach(pt => {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  });
  
  const padding = 0.10;
  const x = Math.max(0, (minX - padding) * canvasW);
  const y = Math.max(0, (minY - padding) * canvasH);
  const w = Math.min(canvasW - x, (maxX - minX + padding * 2) * canvasW);
  const h = Math.min(canvasH - y, (maxY - minY + padding * 2) * canvasH);
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  
  const r = Math.min(8, w / 10);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.stroke();
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.fill();
  
  const textLabel = `${emoji} ${name}`;
  const fontSize = Math.max(20, Math.round(w / 12));
  ctx.font = `bold ${fontSize}px "Fusion Pixel 12px Monospaced SC", "Courier New", monospace`;
  const textWidth = ctx.measureText(textLabel).width;
  const paddingX = 10;
  const labelHeight = fontSize + 10;
  
  const labelY = y - labelHeight - 6 > 0 ? y - labelHeight - 6 : y + 6;
  const labelWidth = textWidth + paddingX * 2;
  const labelRight = x + labelWidth;
  
  ctx.save();
  ctx.translate(labelRight, 0);
  ctx.scale(-1, 1);
  
  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(0, labelY, labelWidth, labelHeight, 5);
  } else {
    ctx.rect(0, labelY, labelWidth, labelHeight);
  }
  ctx.fill();
  
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(textLabel, paddingX, labelY + labelHeight / 2);
  
  ctx.restore();
}

function studioDetectionLoop(now) {
  if (!studioStream || !faceLandmarkerLoaded || snapImage) {
    studioDetectionAnimId = requestAnimationFrame(studioDetectionLoop);
    return;
  }
  
  if (now - lastStudioProcessTime >= 80) {
    lastStudioProcessTime = now;
    
    if (studioVideo.readyState === studioVideo.HAVE_ENOUGH_DATA) {
      if (studioCanvas.width !== studioVideo.videoWidth || studioCanvas.height !== studioVideo.videoHeight) {
        studioCanvas.width = studioVideo.videoWidth;
        studioCanvas.height = studioVideo.videoHeight;
      }
      
      sCtx.clearRect(0, 0, studioCanvas.width, studioCanvas.height);
      
      sCtx.save();
      sCtx.translate(studioCanvas.width, 0);
      sCtx.scale(-1, 1);
      
      try {
        const results = faceLandmarker.detectForVideo(studioVideo, now);
        
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
          const landmarks = results.faceLandmarks[0];
          
          let emotions = { happy: 0, sad: 0, angry: 0, surprise: 0, fear: 0, disgust: 0, neutral: 1 };
          
          if (results.faceBlendshapes && results.faceBlendshapes[0]) {
            const blendshapes = {};
            results.faceBlendshapes[0].categories.forEach(item => {
              blendshapes[item.categoryName] = item.score;
            });
            emotions = classifyEmotionsFromBlendshapes(blendshapes);
          }
          
          const dominantEmotion = Object.keys(emotions).reduce((a, b) => emotions[a] > emotions[b] ? a : b);
          const dominantScore = emotions[dominantEmotion];
          
          lastStudioFaceData = {
            landmarks: landmarks,
            emotions: emotions,
            dominantEmotion: dominantEmotion,
            dominantScore: dominantScore
          };
          
          if (studioShowMesh) {
            drawStudioMesh(sCtx, landmarks, dominantEmotion, studioCanvas.width, studioCanvas.height);
          }
          drawStudioFaceBox(sCtx, lastStudioFaceData, studioCanvas.width, studioCanvas.height);
          updateStudioEmotionPanel(emotions);
          setStudioSpriteEmotion(dominantEmotion);
        } else {
          lastStudioFaceData = null;
        }
      } catch (e) {
        console.error('[Studio Detection] 检测出错:', e);
      }
      
      sCtx.restore();
    }
  }
  
  studioDetectionAnimId = requestAnimationFrame(studioDetectionLoop);
}

// 初始化摄像头
async function startStudioCamera() {
  try {
    if (studioStream) return;
    
    marqueeText.textContent = "正在请求摄像头权限...";
    
    if (!faceLandmarkerLoaded) {
      initStudioMediaPipe();
    }
    
    const constraints = { video: { width: 320, height: 320, facingMode: 'user' } };
    studioStream = await navigator.mediaDevices.getUserMedia(constraints);
    studioVideo.srcObject = studioStream;
    btnCamToggle.querySelector('.btn-text').innerHTML = '<i class="fa-solid fa-power-off"></i> 关闭摄像头';
    marqueeText.textContent = "摄像头连接成功！调整您的表情，按下快门拍摄专属表情。";
    playChiptuneNote(600, null, 0.1, 'sine', 0.05);
    
    initStudioSprite();
    
    studioVideo.onloadedmetadata = () => {
      studioCanvas.width = studioVideo.videoWidth;
      studioCanvas.height = studioVideo.videoHeight;
    };
    
    if (!studioDetectionAnimId) {
      studioDetectionAnimId = requestAnimationFrame(studioDetectionLoop);
    }
  } catch (err) {
    console.error("Camera access error:", err);
    marqueeText.textContent = "摄像头开启失败，已启用复古电视测试彩条作为代替。";
    startFallbackStudioFeed();
  }
}

function stopStudioCamera() {
  if (studioStream) {
    studioStream.getTracks().forEach(track => track.stop());
    studioStream = null;
    studioVideo.srcObject = null;
  }
  btnCamToggle.querySelector('.btn-text').innerHTML = '<i class="fa-solid fa-power-off"></i> 启动摄像头';
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }
  lastStudioFaceData = null;
  sCtx.clearRect(0, 0, studioCanvas.width, studioCanvas.height);
  stopStudioSprite();
}

// 摄像头未授权 fallback 彩条渲染
let fallbackInterval = null;
function startFallbackStudioFeed() {
  if (fallbackInterval) clearInterval(fallbackInterval);
  studioVideo.style.display = 'none'; // 隐藏真实 video 标签
  studioCanvas.width = 230;
  studioCanvas.height = 230;
  
  let offset = 0;
  fallbackInterval = setInterval(() => {
    if (snapImage) return; // 拍照后停止彩条动画
    
    // 1. 复古电视测试彩条
    const colors = ['#ffffff', '#eab308', '#00f0ff', '#10b981', '#ff007f', '#ef4444', '#0000ff'];
    const w = studioCanvas.width / colors.length;
    for (let i = 0; i < colors.length; i++) {
      sCtx.fillStyle = colors[i];
      sCtx.fillRect(i * w, 0, w, studioCanvas.height * 0.7);
    }
    
    // 底部灰度与雪花
    sCtx.fillStyle = '#333';
    sCtx.fillRect(0, studioCanvas.height * 0.7, studioCanvas.width, studioCanvas.height * 0.3);
    
    // 绘制跳动波形
    sCtx.strokeStyle = 'var(--color-pink)';
    sCtx.lineWidth = 2;
    sCtx.beginPath();
    for (let x = 0; x < studioCanvas.width; x++) {
      const y = studioCanvas.height * 0.85 + Math.sin(x * 0.05 + offset) * 15;
      if (x === 0) sCtx.moveTo(x, y);
      else sCtx.lineTo(x, y);
    }
    sCtx.stroke();
    
    offset += 0.25;
  }, 50);
}

// 拍照功能
function takeSnapshot() {
  if (btnSnap.querySelector('.btn-text').textContent.includes("重拍")) {
    // 重置拍立得状态
    snapImage = null;
    sCtx.clearRect(0, 0, studioCanvas.width, studioCanvas.height);
    studioVideo.style.display = 'block';
    btnSnap.querySelector('.btn-text').innerHTML = '<i class="fa-solid fa-camera"></i> 按下快门 (拍照)';
    stickerTraySection.classList.add('hidden');
    
    // 移除画面中的全部贴纸元素
    document.querySelectorAll('.placed-sticker').forEach(el => el.remove());
    marqueeText.textContent = "已重置。请重新调整姿态并按下快门拍摄。";
    return;
  }

  // 快门声与全屏闪烁
  playShutterSound();
  
  // 闪烁特效
  const flash = document.createElement('div');
  flash.style.position = 'fixed';
  flash.style.top = '0'; flash.style.left = '0';
  flash.style.width = '100vw'; flash.style.height = '100vh';
  flash.style.backgroundColor = '#fff';
  flash.style.zIndex = '9999';
  flash.style.opacity = '1';
  flash.style.transition = 'opacity 0.25s ease-out';
  document.body.appendChild(flash);
  setTimeout(() => {
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), 250);
  }, 50);

  // 冻结当前帧 - 保留人脸框
  if (studioStream) {
    // 将视频帧绘制到 Canvas 上
    sCtx.save();
    sCtx.translate(studioCanvas.width, 0);
    sCtx.scale(-1, 1);
    sCtx.drawImage(studioVideo, 0, 0, studioCanvas.width, studioCanvas.height);
    sCtx.restore();
    
    // 如果有人脸数据，绘制人脸框和网格
    if (lastStudioFaceData) {
      sCtx.save();
      sCtx.translate(studioCanvas.width, 0);
      sCtx.scale(-1, 1);
      if (studioShowMesh) {
        drawStudioMesh(sCtx, lastStudioFaceData.landmarks, lastStudioFaceData.dominantEmotion, studioCanvas.width, studioCanvas.height);
      }
      drawStudioFaceBox(sCtx, lastStudioFaceData, studioCanvas.width, studioCanvas.height);
      sCtx.restore();
    }
    
    studioVideo.style.display = 'none'; // 冻结流
  } else {
    snapImage = sCtx.getImageData(0, 0, studioCanvas.width, studioCanvas.height);
  }
  
  snapImage = true;
  btnSnap.querySelector('.btn-text').innerHTML = '<i class="fa-solid fa-rotate-left"></i> 重拍';
  stickerTraySection.classList.remove('hidden');
  marqueeText.textContent = "拍摄定格！点击下方像素贴纸，拖拽并摆放它，编写右下方矫情文字吧！";
}

// 添加贴纸与拖拽逻辑
function spawnSticker(emoji) {
  if (!snapImage) return;

  const wrapper = document.querySelector('.polaroid-screen-wrapper');
  const sticker = document.createElement('span');
  sticker.className = 'placed-sticker';
  sticker.textContent = emoji;
  sticker.id = `sticker-${stickerIdCounter++}`;
  
  sticker.style.left = '100px';
  sticker.style.top = '100px';
  sticker.dataset.scale = '1';
  sticker.dataset.rotation = '0';
  
  wrapper.appendChild(sticker);
  
  playChiptuneNote(700, null, 0.05, 'triangle', 0.05);
  
  let isDragging = false;
  let isRotating = false;
  let startX, startY;
  let initialLeft, initialTop;
  let initialRotation;
  
  sticker.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      isRotating = true;
      sticker.classList.add('selected');
      activeSticker = sticker;
      startX = e.clientX;
      initialRotation = parseFloat(sticker.dataset.rotation);
      e.preventDefault();
      return;
    }
    
    isDragging = true;
    sticker.classList.add('selected');
    activeSticker = sticker;
    
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = parseInt(sticker.style.left);
    initialTop = parseInt(sticker.style.top);
    
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (isRotating) {
      const dx = e.clientX - startX;
      const rotation = initialRotation + dx * 0.5;
      sticker.dataset.rotation = rotation;
      sticker.style.transform = `scale(${sticker.dataset.scale}) rotate(${rotation}deg)`;
      return;
    }
    
    if (!isDragging) return;
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;
    
    const containerSize = studioCanvas.width || 230;
    const stickerSize = 28 * parseFloat(sticker.dataset.scale);
    newLeft = Math.max(-stickerSize, Math.min(newLeft, containerSize));
    newTop = Math.max(-stickerSize, Math.min(newTop, containerSize));
    
    sticker.style.left = `${newLeft}px`;
    sticker.style.top = `${newTop}px`;
  });
  
  sticker.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    let scale = parseFloat(sticker.dataset.scale) + delta;
    scale = Math.max(0.3, Math.min(scale, 3));
    sticker.dataset.scale = scale;
    sticker.style.transform = `scale(${scale}) rotate(${sticker.dataset.rotation}deg)`;
  }, { passive: false });
  
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      sticker.classList.remove('selected');
    }
    if (isRotating) {
      isRotating = false;
      sticker.classList.remove('selected');
    }
  });

  sticker.addEventListener('dblclick', () => {
    sticker.remove();
    playChiptuneNote(300, null, 0.08, 'sawtooth', 0.05);
  });
}

// 导出下载拍立得 PNG
function downloadPolaroid() {
  if (!snapImage) {
    marqueeText.textContent = "请先拍摄照片后再导出表情包！";
    return;
  }

  // 创建离线绘制 Canvas (500x600 高清分辨率)
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = 500;
  exportCanvas.height = 600;
  const eCtx = exportCanvas.getContext('2d');
  
  // 1. 绘制拍立得暖白背景
  eCtx.fillStyle = '#fffdf5';
  eCtx.fillRect(0, 0, 500, 600);
  
  // 2. 绘制极轻微卡片纸张纹理感
  eCtx.strokeStyle = 'rgba(92, 44, 6, 0.05)';
  eCtx.lineWidth = 1;
  eCtx.strokeRect(2, 2, 496, 596);

  // 3. 绘制照片主画面 (放大于中心 460x460，上下留空)
  // 将小 studioCanvas 拷贝到 exportCanvas
  eCtx.drawImage(studioCanvas, 20, 20, 460, 460);

  // 4. 渲染拖拽贴纸 (Scale因子为 460 / 230 = 2)
  eCtx.font = '56px sans-serif'; // 贴纸双倍分辨率渲染
  eCtx.textAlign = 'left';
  eCtx.textBaseline = 'top';
  
  document.querySelectorAll('.placed-sticker').forEach(el => {
    const left = parseInt(el.style.left) || 0;
    const top = parseInt(el.style.top) || 0;
    
    const scaleX = 20 + left * 2;
    const scaleY = 20 + top * 2;
    
    eCtx.fillText(el.textContent, scaleX, scaleY);
  });

  // 5. 渲染底部的文字输入
  const textVal = document.getElementById('polaroid-caption').value.trim() || "生而为人，我很抱歉 🥀";
  eCtx.fillStyle = '#5c2c06';
  eCtx.font = '24px "Fusion Pixel 12px Monospaced SC", monospace';
  eCtx.textAlign = 'center';
  eCtx.textBaseline = 'middle';
  eCtx.fillText(textVal, 250, 535);

  // 写入复古标签
  eCtx.fillStyle = 'rgba(92, 44, 6, 0.2)';
  eCtx.font = '10px "Fusion Pixel 12px Monospaced SC", monospace';
  eCtx.fillText('EMO RETRO STUDIO v1.2', 250, 575);

  // 导出下载
  const url = exportCanvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = `emo-polaroid-${Date.now()}.png`;
  link.href = url;
  link.click();
  
  playChiptuneNote(1000, null, 0.15, 'square', 0.06);
  marqueeText.textContent = "表情包导出成功！快去分享你的悲伤吧。";
}

// ==========================================
// 6. 情绪摄影机 (MindLens Camera) 核心逻辑
// ==========================================

let vhsStream = null;
let vhsTimecodeInterval = null;
let vhsSeconds = 0;

// === 游戏化情绪探索状态 ===
let isExploring = false;
let mockEmotionInterval = null;
let emotionHistory = { happy: 0, sad: 0, angry: 0, surprise: 0, fear: 0, disgust: 0, neutral: 0 };
let emotionTimeline = [];
let lastTimelinePushTime = 0;
let chartCanvas = null;
let chartAnimId = null;
let lastAiSuggestionResult = null;
let comboStreak = 0;
let lastComboEmotion = null;
let lastComboPopupTime = 0;
let lastComboStreakTime = 0;
let comboPopupTimer = null;

const vhsVideo = document.getElementById('vhs-video');

// UI 节点
const btnVhsToggle = document.getElementById('btn-vhs-camera-toggle');
const btnVhsFinish = document.getElementById('btn-vhs-finish');
const btnVhsRestart = document.getElementById('btn-vhs-restart');
const btnVhsMeshToggle = document.getElementById('btn-vhs-mesh-toggle');
const btnVhsRestartResult = document.getElementById('btn-vhs-restart-result');
const btnVhsBackResult = document.getElementById('btn-vhs-back-result');
const btnVhsBack = document.getElementById('btn-vhs-back');
const aiAvatar = document.getElementById('ai-avatar');
const mlExploreControls = document.getElementById('ml-explore-controls');
const mlRunningControls = document.getElementById('ml-running-controls');
const mlCardContent = document.getElementById('ml-card-content');
const runningTimer = document.getElementById('running-timer');
const resultTimer = document.getElementById('result-timer');
const mockEmotionTag = document.getElementById('mock-emotion-tag');
const mockEmotionProb = document.getElementById('mock-emotion-prob');
const hudRecIndicator = document.getElementById('hud-rec-indicator');
const btnCloseRoleCard = document.getElementById('btn-close-role-card');
const timecodeDisplay = document.getElementById('vhs-timecode');
const vhsOverlay = document.getElementById('vhs-overlay');
const vCtx = vhsOverlay ? vhsOverlay.getContext('2d') : null;

async function startVhsCamera() {
  try {
    if (vhsStream) return;
    
    marqueeText.textContent = "正在请求摄像头权限...";
    
    if (!faceLandmarkerLoaded) {
      await initStudioMediaPipe();
    }
    
    const constraints = { video: { width: 640, height: 480, facingMode: 'user' } };
    vhsStream = await navigator.mediaDevices.getUserMedia(constraints);
    vhsVideo.srcObject = vhsStream;
    
    marqueeText.textContent = "情绪探索已开启！请面对镜头展现你最真实的情绪变化。";
    
    vhsVideo.onloadedmetadata = () => {
      if (vhsOverlay) {
        vhsOverlay.width = vhsVideo.videoWidth;
        vhsOverlay.height = vhsVideo.videoHeight;
      }
    };
  } catch (err) {
    console.error("VHS camera error:", err);
    marqueeText.textContent = "摄像头未连接或无权限，已开启【无画面模拟探索模式】！";
  } finally {
    if (mlExploreControls) mlExploreControls.style.display = 'none';
    if (mlRunningControls) mlRunningControls.classList.remove('hide');
    playChiptuneNote(600, null, 0.1, 'sine', 0.05);
    
    startExploration(); // 启动游戏化循环
  }
}

function stopVhsCamera() {
  if (vhsStream) {
    vhsStream.getTracks().forEach(track => track.stop());
    vhsStream = null;
    vhsVideo.srcObject = null;
  }
  if (mlExploreControls) mlExploreControls.style.display = 'flex';
  if (mlRunningControls) mlRunningControls.classList.add('hide');
  stopExploration(); // 停止游戏化循环
  if (vhsDetectionAnimId) {
    cancelAnimationFrame(vhsDetectionAnimId);
    vhsDetectionAnimId = null;
  }
  if (vCtx && vhsOverlay) {
    vCtx.clearRect(0, 0, vhsOverlay.width, vhsOverlay.height);
  }
}

// ==========================================
// 情绪探索引擎 (Mock AI) & 成长系统
// ==========================================

function startExploration() {
  isExploring = true;
  emotionHistory = { happy: 0, sad: 0, angry: 0, surprise: 0, fear: 0, disgust: 0, neutral: 0 };
  emotionTimeline = [];
  lastTimelinePushTime = 0;
  lastAiSuggestionResult = null;
  comboStreak = 0;
  lastComboEmotion = null;
  lastComboPopupTime = 0;
  lastComboStreakTime = 0;
  if (comboPopupTimer) { clearTimeout(comboPopupTimer); comboPopupTimer = null; }
  const existingPopup = document.getElementById('sprite-combo-popup');
  if (existingPopup) existingPopup.classList.remove('show');
  
  // 重置小精灵为不可点击且更新气泡
  const cameraAiBox = document.querySelector('.camera-ai-box');
  if (cameraAiBox) cameraAiBox.classList.remove('clickable');
  const aiBubble = document.getElementById('ai-dialogue-bubble');
  if (aiBubble) aiBubble.innerHTML = '我现在正在认真记录你的表情哦，请继续展示你的情绪吧！🎬';
  
  if (typeof setSpriteEmotion === 'function') setSpriteEmotion('happy');
  
  hudRecIndicator.innerHTML = '<i class="fa-solid fa-circle text-red flash"></i> REC';
  if (mlExploreControls) mlExploreControls.style.display = 'none';
  if (mlRunningControls) mlRunningControls.classList.remove('hide');
  if (mlCardContent) mlCardContent.classList.add('hide');
  
  startVhsTimecode();
  startWaveformAnim();
  startRunningTimer();
  initEmotionChart();
  startChartRender();
  
  // 模拟每 1.5 秒进行一次情绪识别
  if (mockEmotionInterval) clearInterval(mockEmotionInterval);
  mockEmotionInterval = setInterval(processMockEmotion, 1500);
}

function stopExploration() {
  isExploring = false;
  hudRecIndicator.innerHTML = '<i class="fa-solid fa-circle text-red"></i> STANDBY';
  mockEmotionTag.textContent = '😐 AWAITING';
  mockEmotionProb.innerHTML = '--% <i class="fa-solid fa-heart"></i>';
  stopVhsTimecode();
  stopWaveformAnim();
  stopRunningTimer();
  stopChartRender();
  if (mockEmotionInterval) {
    clearInterval(mockEmotionInterval);
    mockEmotionInterval = null;
  }
}

let vhsDetectionAnimId = null;
let lastVhsProcessTime = 0;

function processMockEmotion() {
  if (!isExploring) return;
  
  if (!vhsDetectionAnimId && vhsVideo && faceLandmarkerLoaded) {
    vhsDetectionAnimId = requestAnimationFrame(vhsDetectionLoop);
  }
}

function vhsDetectionLoop(now) {
  if (!isExploring || !vhsStream || !faceLandmarkerLoaded) {
    vhsDetectionAnimId = null;
    return;
  }
  
  if (now - lastVhsProcessTime >= 100) {
    lastVhsProcessTime = now;
    
    if (vhsVideo.readyState === vhsVideo.HAVE_ENOUGH_DATA) {
      if (vhsOverlay && (vhsOverlay.width !== vhsVideo.videoWidth || vhsOverlay.height !== vhsVideo.videoHeight)) {
        vhsOverlay.width = vhsVideo.videoWidth;
        vhsOverlay.height = vhsVideo.videoHeight;
      }
      
      if (vCtx) {
        vCtx.clearRect(0, 0, vhsOverlay.width, vhsOverlay.height);
      }
      
      try {
        const results = faceLandmarker.detectForVideo(vhsVideo, now);
        
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
          const landmarks = results.faceLandmarks[0];
          
          let emotions = { happy: 0, sad: 0, angry: 0, surprise: 0, fear: 0, disgust: 0, neutral: 1 };
          
          if (results.faceBlendshapes && results.faceBlendshapes[0]) {
            const blendshapes = {};
            results.faceBlendshapes[0].categories.forEach(item => {
              blendshapes[item.categoryName] = item.score;
            });
            emotions = classifyEmotionsFromBlendshapes(blendshapes);
          }
          
          const dominantEmotion = Object.keys(emotions).reduce((a, b) => emotions[a] > emotions[b] ? a : b);
          const dominantScore = Math.round(emotions[dominantEmotion] * 100);
          
          if (vCtx) {
            if (vhsShowMesh) {
              drawStudioMesh(vCtx, landmarks, dominantEmotion, vhsOverlay.width, vhsOverlay.height);
            }
            drawStudioFaceBox(vCtx, { landmarks, emotions, dominantEmotion, dominantScore }, vhsOverlay.width, vhsOverlay.height);
          }
          
          updateVhsEmotionUI(dominantEmotion, dominantScore, emotions);
        }
      } catch (e) {
        console.error('[VHS Detection] 检测出错:', e);
      }
    }
  }
  
  vhsDetectionAnimId = requestAnimationFrame(vhsDetectionLoop);
}

function updateVhsEmotionUI(emotion, prob, emotions) {
  const STUDIO_EMOTION_MAP = {
    happy: { emoji: '😄', name: '开心', color: '#fde047', energy: 5 },
    sad: { emoji: '😢', name: '悲伤', color: '#3b82f6', energy: 1 },
    angry: { emoji: '😠', name: '愤怒', color: '#ef4444', energy: 3 },
    surprise: { emoji: '😲', name: '惊讶', color: '#f59e0b', energy: 4 },
    fear: { emoji: '😨', name: '恐惧', color: '#8b5cf6', energy: 2 },
    disgust: { emoji: '🤢', name: '厌恶', color: '#a855f7', energy: 2 },
    neutral: { emoji: '😐', name: '平静', color: '#6b7280', energy: 2 }
  };
  
  const emoInfo = STUDIO_EMOTION_MAP[emotion] || STUDIO_EMOTION_MAP.neutral;
  
  emotionHistory[emotion] = (emotionHistory[emotion] || 0) + 1;
  
  const now = performance.now();
  if (now - lastTimelinePushTime >= 1000) {
    lastTimelinePushTime = now;
    emotionTimeline.push({
      sec: emotionTimeline.length + 1,
      emotion: emotion,
      icon: emoInfo.emoji,
      prob: prob,
      probs: { ...emotions }
    });
    drawEmotionChart();
  }
  
  mockEmotionTag.textContent = `${emoInfo.emoji} ${emoInfo.name}`;
  mockEmotionTag.style.color = emoInfo.color;
  mockEmotionProb.innerHTML = `${prob}% <i class="fa-solid fa-heart"></i>`;
  
  if (typeof setSpriteEmotion === 'function') {
    setSpriteEmotion(emotion);
  }
  
  const energyGain = emoInfo.energy;
  
  if (now - lastComboStreakTime >= 1000) {
    lastComboStreakTime = now;
    if (lastComboEmotion === emotion) {
      comboStreak++;
    } else {
      comboStreak = 1;
      lastComboEmotion = emotion;
    }
  } else if (lastComboEmotion !== emotion) {
    comboStreak = 1;
    lastComboEmotion = emotion;
  }
  
  const popupCooldown = energyGain > 2 ? 1800 : 3500;
  if (now - lastComboPopupTime >= popupCooldown) {
    lastComboPopupTime = now;
    showComboPopup(emoInfo, comboStreak, energyGain);
    if (energyGain > 2) {
      playChiptuneNote(800 + energyGain * 50, null, 0.1, 'square', 0.05);
    }
  }
}

function showComboPopup(emoInfo, streak, energy) {
  const popup = document.getElementById('sprite-combo-popup');
  if (!popup) return;
  const emojiEl = document.getElementById('combo-popup-emoji');
  const textEl = document.getElementById('combo-popup-text');
  const energyEl = document.getElementById('combo-popup-energy');
  if (!emojiEl || !textEl || !energyEl) return;
  
  emojiEl.textContent = emoInfo.emoji;
  if (energy > 2 && streak >= 2) {
    textEl.textContent = `${emoInfo.name} Combo × ${streak}`;
  } else if (energy > 2) {
    textEl.textContent = `${emoInfo.name} Combo!`;
  } else {
    textEl.textContent = `${emoInfo.name} 保持状态`;
  }
  energyEl.textContent = `✨ 能量 +${energy}`;
  
  if (comboPopupTimer) clearTimeout(comboPopupTimer);
  popup.classList.remove('show');
  requestAnimationFrame(() => {
    popup.classList.add('show');
  });
  comboPopupTimer = setTimeout(() => {
    popup.classList.remove('show');
    comboPopupTimer = null;
  }, 1200);
}

let waveformAnimId = null;
function startWaveformAnim() {
  const container = document.getElementById('ml-waveform');
  if (!container) return;
  container.innerHTML = '';
  for(let i=0; i<30; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    container.appendChild(bar);
  }
  
  function updateBars() {
    if(!isExploring) return;
    const bars = container.children;
    for(let i=0; i<bars.length; i++) {
      bars[i].style.height = `${2 + Math.random() * 20}px`;
    }
    waveformAnimId = setTimeout(updateBars, 150);
  }
  updateBars();
}

function stopWaveformAnim() {
  if(waveformAnimId) clearTimeout(waveformAnimId);
  const container = document.getElementById('ml-waveform');
  if(container) {
    const bars = container.children;
    for(let i=0; i<bars.length; i++) bars[i].style.height = '2px';
  }
}

// ==========================================
// 角色卡结算系统 (纯前端规则映射)
// ==========================================

function finishAndGenerateCard() {
  stopExploration();
  playChiptuneNote(1000, null, 0.3, 'sine', 0.1);
  
  if (vhsVideo) vhsVideo.pause();
  
  // 规则映射：找出占比最高的情绪
  let dominantEmotion = 'calm';
  let maxCount = -1;
  let totalCount = 0;
  for (const [emo, count] of Object.entries(emotionHistory)) {
    totalCount += count;
    if (count > maxCount) {
      maxCount = count;
      dominantEmotion = emo;
    }
  }

  // 根据主导情绪分配角色
  let rIcon = '😐';
  let rName = '观察者';

  if (dominantEmotion === 'happy') {
    rIcon = '☀️'; rName = '小太阳';
  } else if (dominantEmotion === 'calm') {
    rIcon = '🌲'; rName = '森林旅人';
  } else if (dominantEmotion === 'surprise') {
    rIcon = '✨'; rName = '星光探险家';
  } else if (dominantEmotion === 'sad') {
    rIcon = '🌧️'; rName = '云朵精灵';
  }

  // 更新卡片内容
  document.getElementById('role-icon').textContent = rIcon;
  document.getElementById('role-name').textContent = rName;
  
  let happyPct = totalCount > 0 ? Math.round((emotionHistory.happy / totalCount) * 100) : 0;
  document.getElementById('role-energy-text').textContent = `${happyPct}%`;
  document.getElementById('role-level-text').textContent = `${emotionHistory.happy}次`;
  
  // 填充情绪分布
  const setDist = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setDist('dist-happy', emotionHistory.happy);
  setDist('dist-neutral', emotionHistory.neutral);
  setDist('dist-sad', emotionHistory.sad);
  setDist('dist-surprise', emotionHistory.surprise);
  setDist('dist-angry', emotionHistory.angry);
  setDist('dist-fear', emotionHistory.fear);
  setDist('dist-disgust', emotionHistory.disgust);
  
  // 切换 UI
  if (mlRunningControls) mlRunningControls.classList.add('hide');
  if (mlCardContent) mlCardContent.classList.remove('hide');
  if (resultTimer && runningTimer) resultTimer.textContent = runningTimer.textContent;
  marqueeText.textContent = `探索完成！你生成了专属角色：【${rName}】。`;
  
  // 录制结束，使小精灵可点击，并更新提示语
  const cameraAiBox = document.querySelector('.camera-ai-box');
  if (cameraAiBox) cameraAiBox.classList.add('clickable');
  const aiBubble = document.getElementById('ai-dialogue-bubble');
  if (aiBubble) aiBubble.innerHTML = '录制结束啦！<br/>快点击我，让我为你进行AI情绪分析吧！✨';
}

// ==========================================
// 分享卡片生成 (Canvas 绘制并下载)
// ==========================================

function generateShareCard() {
  const W = 600;
  const H = 800;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // —— 背景 ——
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#221001');
  bgGrad.addColorStop(1, '#120700');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 装饰网格
  ctx.strokeStyle = 'rgba(217, 119, 6, 0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 30) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // 外边框
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(20, 20, W - 40, H - 40);
  ctx.setLineDash([]);

  // —— 顶部标题 ——
  ctx.fillStyle = '#eab308';
  ctx.font = 'bold 28px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('✨ 情绪角色卡 ✨', W / 2, 70);

  // 副标题
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '14px "Courier New", monospace';
  const dateStr = new Date().toLocaleDateString('zh-CN');
  ctx.fillText(`MindLens 心镜 · ${dateStr}`, W / 2, 95);

  // —— 角色图标区域 ——
  const iconY = 170;
  const rIcon = document.getElementById('role-icon').textContent;
  const rName = document.getElementById('role-name').textContent;

  // 图标背景圆
  ctx.beginPath();
  ctx.arc(W / 2, iconY, 60, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(234, 179, 8, 0.1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 角色图标 emoji
  ctx.font = '72px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(rIcon, W / 2, iconY);
  ctx.textBaseline = 'alphabetic';

  // 角色标签
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '13px "Courier New", monospace';
  ctx.fillText('今日情绪角色', W / 2, 260);

  // 角色名
  ctx.fillStyle = '#ff9800';
  ctx.font = 'bold 32px "Courier New", monospace';
  ctx.fillText(rName, W / 2, 300);

  // —— 分割线 ——
  const lineY = 330;
  const lineGrad = ctx.createLinearGradient(60, 0, W - 60, 0);
  lineGrad.addColorStop(0, 'transparent');
  lineGrad.addColorStop(0.5, '#f97316');
  lineGrad.addColorStop(1, 'transparent');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, lineY);
  ctx.lineTo(W - 60, lineY);
  ctx.stroke();

  // —— 统计数据区 ——
  let statY = 370;
  const statX = 80;
  const valX = W - 80;

  const energyText = document.getElementById('role-energy-text').textContent;
  const levelText = document.getElementById('role-level-text').textContent;
  const timerText = resultTimer ? resultTimer.textContent : '00:00';

  const drawStat = (label, value, color) => {
    ctx.fillStyle = '#eab308';
    ctx.font = '18px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, statX, statY);
    ctx.fillStyle = color;
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(value, valX, statY);
    statY += 40;
  };

  drawStat('快乐值', energyText, '#f97316');
  drawStat('连击次数', levelText, '#eab308');
  drawStat('探索时长', timerText, '#fff');

  // —— 情绪分布柱状图 ——
  statY += 10;
  ctx.fillStyle = '#aaa';
  ctx.font = '16px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('情绪分布', statX, statY);
  statY += 25;

  const emotions = [
    { name: '😃 开心', count: emotionHistory.happy, color: '#10b981' },
    { name: '😐 平静', count: emotionHistory.neutral, color: '#6b7280' },
    { name: '😢 悲伤', count: emotionHistory.sad, color: '#3b82f6' },
    { name: '😲 惊讶', count: emotionHistory.surprise, color: '#f59e0b' },
    { name: '😠 愤怒', count: emotionHistory.angry, color: '#ef4444' },
    { name: '😨 恐惧', count: emotionHistory.fear, color: '#8b5cf6' },
    { name: '🤢 厌恶', count: emotionHistory.disgust, color: '#a855f7' },
  ];
  const maxEmoCount = Math.max(...emotions.map(e => e.count), 1);
  const barW = W - 160 - 100;
  const barH = 22;

  emotions.forEach((emo) => {
    // 标签
    ctx.fillStyle = '#ddd';
    ctx.font = '15px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(emo.name, statX, statY + 16);
    // 数量
    ctx.fillStyle = '#aaa';
    ctx.font = '13px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`×${emo.count}`, W - 80, statY + 16);
    statY += 22;
    // 柱条背景
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(statX, statY, barW, barH);
    // 柱条
    const fillW = (emo.count / maxEmoCount) * barW;
    ctx.fillStyle = emo.color;
    ctx.fillRect(statX, statY, fillW, barH);
    statY += barH + 12;
  });

  // —— 底部信息 ——
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '12px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('EMO-ARCADE SYSTEM v1.2 · MindLens 心镜', W / 2, H - 55);

  ctx.fillStyle = 'rgba(234, 179, 8, 0.5)';
  ctx.font = '11px "Courier New", monospace';
  ctx.fillText('今天你emo了吗？', W / 2, H - 35);

  // —— 下载图片 ——
  const link = document.createElement('a');
  link.download = `MindLens-${rName}-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();

  playChiptuneNote(800, null, 0.15, 'sine', 0.08);
  if (marqueeText) marqueeText.textContent = `角色卡已保存！快去分享你的【${rName}】吧～`;
}

// 绑定生成分享卡片按钮
if(btnCloseRoleCard) {
  btnCloseRoleCard.addEventListener('click', () => {
    generateShareCard();
  });
}

// 绑定重启按钮（运行中状态）
if (btnVhsRestart) {
  btnVhsRestart.addEventListener('click', () => {
    playChiptuneNote(500, null, 0.1, 'sine', 0.05);
    startExploration();
    if (vhsVideo) vhsVideo.play();
  });
}

if (btnVhsMeshToggle) {
  btnVhsMeshToggle.addEventListener('click', () => {
    vhsShowMesh = !vhsShowMesh;
    btnVhsMeshToggle.querySelector('.btn-text').innerHTML = 
      vhsShowMesh 
        ? '<i class="fa-solid fa-grid-3x3"></i> 隐藏网格' 
        : '<i class="fa-solid fa-grid-3x3"></i> 显示网格';
  });
}

// 绑定重启按钮（结算状态）
if (btnVhsRestartResult) {
  btnVhsRestartResult.addEventListener('click', () => {
    playChiptuneNote(500, null, 0.1, 'sine', 0.05);
    startExploration();
    if (vhsVideo) vhsVideo.play();
  });
}

// 绑定返回按钮（结算状态）
if (btnVhsBackResult) {
  btnVhsBackResult.addEventListener('click', () => {
    playChiptuneNote(400, null, 0.1, 'sine', 0.05);
    stopVhsCamera();
    if (mlCardContent) mlCardContent.classList.add('hide');
    document.getElementById('stage-camera').classList.remove('active');
    document.getElementById('stage-select').classList.add('active');
    marqueeText.textContent = "选择您的悲浪舱：进入“情绪照相馆”或“情绪摄影机”...";
  });
}

// 绑定返回主仓按钮（始终显示）
if (btnVhsBack) {
  btnVhsBack.addEventListener('click', () => {
    playChiptuneNote(400, null, 0.1, 'sine', 0.05);
    stopVhsCamera();
    if (mlCardContent) mlCardContent.classList.add('hide');
    document.getElementById('stage-camera').classList.remove('active');
    document.getElementById('stage-select').classList.add('active');
    marqueeText.textContent = "选择您的悲浪舱：进入“情绪照相馆”或“情绪摄影机”...";
  });
}

// 格式化时间码 00:00:00
function formatTimecode(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// 开启 VHS 时间码累加器
function startVhsTimecode() {
  vhsSeconds = 0;
  timecodeDisplay.textContent = formatTimecode(0);
  if (vhsTimecodeInterval) clearInterval(vhsTimecodeInterval);
  
  vhsTimecodeInterval = setInterval(() => {
    vhsSeconds++;
    timecodeDisplay.textContent = formatTimecode(vhsSeconds);
  }, 1000);
}

function stopVhsTimecode() {
  if (vhsTimecodeInterval) {
    clearInterval(vhsTimecodeInterval);
    vhsTimecodeInterval = null;
  }
}

// 运行计时器（右侧面板显示）
let runningTimerInterval = null;
function startRunningTimer() {
  if (!runningTimer) return;
  let sec = 0;
  runningTimer.textContent = '00:00';
  if (runningTimerInterval) clearInterval(runningTimerInterval);
  
  runningTimerInterval = setInterval(() => {
    sec++;
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    runningTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopRunningTimer() {
  if (runningTimerInterval) {
    clearInterval(runningTimerInterval);
    runningTimerInterval = null;
  }
}


// 情绪合成音效板触发
function playSynthSound(key) {
  initAudio();
  const now = audioCtx.currentTime;
  
  if (key === '1') {
    // 悲叹长鸣 (Fad-in major minor sweep)
    playChiptuneNote(220, now, 1.2, 'sawtooth', 0.12);
    playChiptuneNote(261.63, now + 0.1, 1.0, 'sawtooth', 0.1);
    playChiptuneNote(329.63, now + 0.2, 0.8, 'sawtooth', 0.08);
  } 
  else if (key === '2') {
    // 重力深渊 (Low sweep arpeggio)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.8);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.8);
  } 
  else if (key === '3') {
    // 信号错位 (Chiptune arpeggio)
    const freqs = [392, 440, 523, 659, 784];
    freqs.forEach((freq, i) => {
      playChiptuneNote(freq, now + i * 0.06, 0.15, 'square', 0.08);
    });
  } 
  else if (key === '4') {
    // 宿命尾音 (Decaying sine vibrato)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(440, now + 1.0);
    
    lfo.frequency.value = 12; // 12Hz Vibrato
    lfoGain.gain.value = 15; // pitch shift deviation
    
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(now);
    lfo.start(now);
    osc.stop(now + 1.0);
    lfo.stop(now + 1.0);
  }
}

// ==========================================
// 7. 模式切换与选择路由
// ==========================================

function enterSelectMode() {
  isEmoMode = true;
  document.body.classList.add('emo-active');

  const indMode = document.getElementById('ind-mode');
  indMode.textContent = "MODE: EMO";
  indMode.classList.remove('red');
  indMode.classList.add('flash');
  indMode.style.color = 'var(--color-pink)';
  indMode.style.textShadow = '0 0 5px var(--color-pink)';

  marqueeText.textContent = "选择您的悲浪舱：进入“情绪照相馆”或“情绪摄影机”...";

  // 隐藏问答，激活路由选择
  document.getElementById('stage-ask').classList.remove('active');
  document.getElementById('stage-select').classList.add('active');

  initMeteors();
  startBgMusic();
}

function resetToNormal() {
  isEmoMode = false;
  document.body.classList.remove('emo-active');

  const indMode = document.getElementById('ind-mode');
  indMode.textContent = "MODE: NORMAL";
  indMode.style.color = '';
  indMode.style.textShadow = '';
  
  marqueeText.textContent = "警报：检测到空气中 Emo 粒子浓度正在上升！请选择您的情绪状态...";

  // 回到起点
  document.getElementById('stage-select').classList.remove('active');
  document.getElementById('stage-studio').classList.remove('active');
  document.getElementById('stage-camera').classList.remove('active');
  document.getElementById('stage-ask').classList.add('active');

  // 关闭相机流
  stopStudioCamera();
  stopVhsCamera();
  stopVhsTimecode();

  // 还原“拒绝”按钮
  noBtnDodgeCount = 0;
  btnNo.addEventListener('mouseover', dodgeButton);
  btnNo.style.position = '';
  btnNo.style.margin = '';
  btnNo.style.left = '';
  btnNo.style.top = '';
  btnNo.style.transform = 'none';
  btnNo.style.pointerEvents = 'auto';
  btnNo.querySelector('.btn-text').textContent = '没有，开心得很 😄';

  initMeteors();
  startBgMusic();
  startAskStage();
}

function startAskStage() {
  typeSentence("今天你 emo 了吗？", 120, () => {
    askButtons.classList.remove('hide');
  });
}

// ==========================================
// 8. 界面与按键监听绑定
// ==========================================

function initEvents() {
  // 音频控制按钮
  const audioToggle = document.getElementById('audio-toggle');
  const audioIcon = document.getElementById('audio-icon');
  const audioText = document.getElementById('audio-text');

  audioToggle.addEventListener('click', () => {
    initAudio();
    isMuted = !isMuted;
    
    if (isMuted) {
      audioIcon.className = 'fa-solid fa-volume-xmark';
      audioText.textContent = "SOUND OFF";
      stopBgMusic();
    } else {
      audioIcon.className = 'fa-solid fa-volume-high';
      audioText.textContent = "SOUND ON";
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      startBgMusic();
      playChiptuneNote(523.25, null, 0.1, 'sine', 0.08);
    }
  });

  // Canvas 点击引爆流星
  canvas.addEventListener('mousedown', (e) => {
    initAudio();
    triggerExplosion(e.clientX, e.clientY);
    checkMeteorClick(e.clientX, e.clientY);
  });

  canvas.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  canvas.addEventListener('mouseleave', () => {
    mouse.x = -1000;
    mouse.y = -1000;
  });

  // “是的”按钮点击进入选择舱
  document.getElementById('btn-yes').addEventListener('click', () => {
    initAudio();
    enterSelectMode();
  });

  // 路由 1：情绪照相馆
  document.getElementById('card-goto-studio').addEventListener('click', () => {
    playChiptuneNote(600, null, 0.15, 'sine', 0.08);
    document.getElementById('stage-select').classList.remove('active');
    document.getElementById('stage-studio').classList.add('active');
    marqueeText.textContent = "欢迎来到情绪照相馆！点击启动摄像头进行合影定格。";
  });

  // 路由 2：情绪摄影机
  document.getElementById('card-goto-camera').addEventListener('click', () => {
    playChiptuneNote(600, null, 0.15, 'sine', 0.08);
    document.getElementById('stage-select').classList.remove('active');
    document.getElementById('stage-camera').classList.add('active');
    marqueeText.textContent = "心镜视界情绪分析模块已就绪。";
    
    // 进入摄影机时重置小精灵状态与气泡
    const cameraAiBox = document.querySelector('.camera-ai-box');
    if (cameraAiBox) cameraAiBox.classList.remove('clickable');
    const aiBubble = document.getElementById('ai-dialogue-bubble');
    if (aiBubble) aiBubble.innerHTML = '启动情绪摄影机，我会为你进行AI分析和建议哦！🤖';
    
    setTimeout(() => {
      if (typeof resizeSpriteCanvas === 'function') {
        resizeSpriteCanvas();
      }
    }, 100);
  });

  // --- 照相馆交互组件事件 ---
  btnCamToggle.addEventListener('click', () => {
    initAudio();
    if (studioStream) {
      stopStudioCamera();
    } else {
      startStudioCamera();
    }
  });

  btnSnap.addEventListener('click', () => {
    initAudio();
    takeSnapshot();
  });

  document.getElementById('btn-studio-toggle-mesh').addEventListener('click', () => {
    initAudio();
    studioShowMesh = !studioShowMesh;
    const btn = document.getElementById('btn-studio-toggle-mesh');
    const text = btn.querySelector('.btn-text');
    if (studioShowMesh) {
      text.innerHTML = '<i class="fa-solid fa-grid-2"></i> 显示网格';
      playChiptuneNote(440, null, 0.1, 'sine', 0.05);
    } else {
      text.innerHTML = '<i class="fa-solid fa-grid-2"></i> 隐藏网格';
      playChiptuneNote(330, null, 0.1, 'sine', 0.05);
    }
  });

  // 贴纸库选择点击
  document.querySelectorAll('.sticker-item').forEach(el => {
    el.addEventListener('click', () => {
      spawnSticker(el.dataset.sticker);
    });
  });

  document.getElementById('btn-studio-download').addEventListener('click', () => {
    downloadPolaroid();
  });

  document.getElementById('btn-studio-back').addEventListener('click', () => {
    playChiptuneNote(400, null, 0.1, 'sine', 0.05);
    stopStudioCamera();
    document.getElementById('stage-studio').classList.remove('active');
    document.getElementById('stage-select').classList.add('active');
    marqueeText.textContent = "选择您的悲浪舱：进入“情绪照相馆”或“情绪摄影机”...";
  });

  // --- 摄影机交互组件事件 ---
  btnVhsToggle.addEventListener('click', () => {
    initAudio();
    if (isExploring) {
      stopVhsCamera();
    } else {
      startVhsCamera();
    }
  });

  btnVhsFinish.addEventListener('click', () => {
    initAudio();
    if (isExploring) {
      finishAndGenerateCard();
    }
  });

  // 合成音效板点击事件
  document.querySelectorAll('.btn-synth').forEach(btn => {
    btn.addEventListener('click', () => {
      playSynthSound(btn.dataset.key);
    });
  });

  // 键盘快捷键监听 (1-4)
  document.addEventListener('keydown', (e) => {
    if (['1', '2', '3', '4'].includes(e.key)) {
      if (document.getElementById('stage-camera').classList.contains('active')) {
        playSynthSound(e.key);
      }
    }
  });

  // 初始化逃跑按钮
  initNoButtonGag();

  // --- AI 情绪顾问点击绑定 ---
  const cameraAiBox = document.querySelector('.camera-ai-box');
  if (cameraAiBox) {
    cameraAiBox.addEventListener('click', () => {
      // 仅当录制结束（isExploring === false）且有数据时才可点击
      if (!isExploring && emotionTimeline.length > 0) {
        openAiSuggestionModal();
      }
    });
  }

  const btnCloseAiModal = document.getElementById('btn-close-ai-modal');
  if (btnCloseAiModal) {
    btnCloseAiModal.addEventListener('click', () => {
      const modal = document.getElementById('ai-suggestion-modal');
      if (modal) {
        modal.classList.remove('active');
        playChiptuneNote(400, null, 0.1, 'sine', 0.05);
      }
    });
  }

  const btnAiModalOk = document.getElementById('btn-ai-modal-ok');
  if (btnAiModalOk) {
    btnAiModalOk.addEventListener('click', () => {
      const modal = document.getElementById('ai-suggestion-modal');
      if (modal) {
        modal.classList.remove('active');
        playChiptuneNote(400, null, 0.1, 'sine', 0.05);
      }
    });
  }
}

// ==========================================
// 9. 系统引导启动
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  requestAnimationFrame(updateCanvas);
  initEvents();
  initPixelSprite();

  setTimeout(() => {
    startAskStage();
  }, 500);
});

// ==========================================
// 10. 像素小精灵 (Pixel Sprite)
// ==========================================

const PIXEL_SIZE = 5;
const SPRITE_W = 32;
const SPRITE_H = 38;

let spriteCanvas = null;
let spriteCtx = null;
let spriteAnimId = null;

let studioSpriteCanvasRef = null;
let studioSpriteCtxRef = null;
let studioSpriteAnimIdRef = null;
let studioSpriteStateRef = { emotion: 'neutral', blinkTimer: 0, blinkPhase: 0, breathePhase: 0, hopOffset: 0 };

let spriteState = {
  emotion: 'happy',
  blinkTimer: 0,
  blinkPhase: 0,
  breathePhase: 0,
  hopOffset: 0,
};

function initStudioSprite() {
  studioSpriteCanvasRef = document.getElementById('studio-sprite-canvas');
  if (!studioSpriteCanvasRef) return;
  studioSpriteCtxRef = studioSpriteCanvasRef.getContext('2d');
  studioSpriteCtxRef.imageSmoothingEnabled = false;
  studioSpriteCanvasRef.width = 160;
  studioSpriteCanvasRef.height = 200;
  studioSpriteStateRef = { emotion: 'neutral', blinkTimer: 0, blinkPhase: 0, breathePhase: 0, hopOffset: 0 };
  animateStudioSprite();
}

function stopStudioSprite() {
  if (studioSpriteAnimIdRef) {
    cancelAnimationFrame(studioSpriteAnimIdRef);
    studioSpriteAnimIdRef = null;
  }
  if (studioSpriteCtxRef && studioSpriteCanvasRef) {
    studioSpriteCtxRef.clearRect(0, 0, studioSpriteCanvasRef.width, studioSpriteCanvasRef.height);
  }
}

function setStudioSpriteEmotion(emo) {
  studioSpriteStateRef.emotion = emo;
}

function animateStudioSprite() {
  studioSpriteStateRef.breathePhase += 0.06;
  studioSpriteStateRef.blinkTimer++;

  if (studioSpriteStateRef.blinkTimer > 180) {
    studioSpriteStateRef.blinkPhase = Math.min(1, studioSpriteStateRef.blinkPhase + 0.15);
    if (studioSpriteStateRef.blinkPhase >= 1) {
      studioSpriteStateRef.blinkTimer = 160 + Math.random() * 60;
    }
  } else if (studioSpriteStateRef.blinkPhase > 0) {
    studioSpriteStateRef.blinkPhase = Math.max(0, studioSpriteStateRef.blinkPhase - 0.15);
    if (studioSpriteStateRef.blinkPhase <= 0) {
      studioSpriteStateRef.blinkTimer = 0;
    }
  }

  studioSpriteStateRef.hopOffset = Math.sin(studioSpriteStateRef.breathePhase) * 2;

  drawStudioPixelSprite();
  studioSpriteAnimIdRef = requestAnimationFrame(animateStudioSprite);
}

let studioOffscreenCanvas = null;
let studioOffscreenCtx = null;

function drawStudioPixelSprite() {
  const c = studioSpriteCtxRef;
  const cav = studioSpriteCanvasRef;
  if (!c || !cav) return;
  const cw = cav.width;
  const ch = cav.height;

  const gridW = 18;
  const gridH = 26;

  if (!studioOffscreenCanvas) {
    studioOffscreenCanvas = document.createElement('canvas');
    studioOffscreenCanvas.width = gridW;
    studioOffscreenCanvas.height = gridH;
    studioOffscreenCtx = studioOffscreenCanvas.getContext('2d');
  }

  const oc = studioOffscreenCtx;
  oc.clearRect(0, 0, gridW, gridH);

  function px(x, y, color) {
    oc.fillStyle = color;
    oc.fillRect(x, y, 1, 1);
  }
  function rect(x, y, w, h, color) {
    oc.fillStyle = color;
    oc.fillRect(x, y, w, h);
  }
  function circle(cx, cy, r, color) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r + r * 0.5) {
          px(cx + dx, cy + dy, color);
        }
      }
    }
  }

  const bodyC = { hi: '#fffbeb', main: '#fde68a', sh: '#f59e0b', out: '#78350f' };
  const leafC = { top: '#4ade80', mid: '#22c55e', sh: '#15803d', hi: '#86efac' };
  const clothC = { top: '#86efac', mid: '#4ade80', sh: '#16a34a', out: '#14532d', btn: '#22c55e' };
  const cheek = '#fb7185';
  const mouthC = '#92400e';
  const tongueC = '#fb7185';
  const teethC = '#ffffff';
  const eyeD = '#1c1917';
  const eyeHi = '#ffffff';
  const tearC = '#60a5fa';
  const tearHi = '#93c5fd';
  const sweatC = '#38bdf8';
  const sweatHi = '#bae6fd';
  const browC = '#78350f';

  const emo = studioSpriteStateRef.emotion;
  const blinkOff = Math.floor(studioSpriteStateRef.blinkPhase * 3);
  const isBlinking = blinkOff >= 3;

  // ===== 叶子 =====
  rect(4, 0, 4, 2, leafC.sh); rect(5, 0, 3, 1, leafC.mid); rect(5, 0, 2, 1, leafC.top);
  px(6, 0, leafC.hi);
  rect(8, 0, 3, 3, leafC.sh); rect(9, 0, 2, 2, leafC.mid); rect(9, 0, 1, 1, leafC.top);
  px(9, 0, leafC.hi);
  rect(11, 0, 4, 2, leafC.sh); rect(12, 0, 3, 1, leafC.mid); rect(12, 0, 2, 1, leafC.top);
  px(13, 0, leafC.hi);
  rect(8, 3, 2, 1, leafC.sh);

  // ===== 圆滚滚身体 =====
  rect(5, 4, 8, 1, bodyC.out);
  rect(4, 5, 10, 1, bodyC.out);
  rect(3, 6, 12, 1, bodyC.out);
  rect(2, 7, 14, 1, bodyC.out);
  for (let r = 0; r < 10; r++) rect(2, 8 + r, 14, 1, bodyC.main);
  rect(2, 18, 14, 1, bodyC.out);
  rect(3, 19, 12, 1, bodyC.out);
  rect(4, 20, 10, 1, bodyC.out);
  rect(4, 20, 10, 3, clothC.mid);
  rect(4, 20, 10, 1, clothC.top);
  rect(4, 22, 10, 1, clothC.sh);
  rect(5, 23, 8, 1, clothC.out);
  rect(7, 24, 4, 1, clothC.out);

  // 高光
  rect(5, 5, 4, 1, bodyC.hi); rect(4, 6, 3, 1, bodyC.hi);
  rect(3, 7, 2, 2, bodyC.hi); rect(2, 9, 1, 2, bodyC.hi);
  // 阴影
  rect(13, 12, 2, 4, bodyC.sh); rect(12, 15, 2, 2, bodyC.sh);

  // 领子+扣子
  rect(7, 18, 6, 1, clothC.out);
  rect(7, 19, 6, 1, clothC.top);
  rect(8, 21, 2, 1, clothC.btn); px(8, 21, '#bbf7d0');

  // ===== 眉毛 =====
  const bY = 9;
  if (emo === 'angry') {
    rect(3, bY, 4, 1, browC); px(2, bY + 1, browC);
    rect(11, bY, 4, 1, browC); px(15, bY + 1, browC);
  } else if (emo === 'sad') {
    rect(3, bY + 1, 4, 1, browC); px(7, bY, browC);
    rect(11, bY + 1, 4, 1, browC); px(10, bY, browC);
  } else if (emo === 'surprise' || emo === 'fear') {
    rect(4, bY - 1, 2, 1, browC); px(3, bY, browC);
    rect(12, bY - 1, 2, 1, browC); px(14, bY, browC);
  } else if (emo === 'happy') {
    rect(4, bY + 1, 2, 1, browC); px(3, bY, browC); px(6, bY, browC);
    rect(12, bY + 1, 2, 1, browC); px(11, bY, browC); px(14, bY, browC);
  } else {
    rect(4, bY + 1, 2, 1, browC);
    rect(12, bY + 1, 2, 1, browC);
  }

  // ===== 圆圆大眼 =====
  const leX = 5, reX = 12;
  const eyY = 12;

  if (!isBlinking) {
    if (emo === 'happy') {
      px(leX, eyY - 1, eyeD); px(leX + 1, eyY - 1, eyeD); px(leX - 1, eyY, eyeD); px(leX + 2, eyY, eyeD);
      rect(leX - 1, eyY + 1, 4, 1, eyeD);
      px(reX, eyY - 1, eyeD); px(reX + 1, eyY - 1, eyeD); px(reX - 1, eyY, eyeD); px(reX + 2, eyY, eyeD);
      rect(reX - 1, eyY + 1, 4, 1, eyeD);
    } else if (emo === 'angry') {
      circle(leX, eyY + 1, 2, '#000');
      circle(reX, eyY + 1, 2, '#000');
      px(leX, eyY + 1, '#ef4444'); px(reX, eyY + 1, '#ef4444');
      px(leX + 1, eyY, eyeHi); px(reX + 1, eyY, eyeHi);
    } else if (emo === 'surprise') {
      circle(leX, eyY, 2, eyeD);
      circle(reX, eyY, 2, eyeD);
      px(leX, eyY, eyeHi); px(reX, eyY, eyeHi);
    } else if (emo === 'fear') {
      circle(leX, eyY, 2, eyeD);
      circle(reX, eyY, 2, eyeD);
      px(leX, eyY + 1, eyeHi); px(reX, eyY + 1, eyeHi);
    } else if (emo === 'sad') {
      circle(leX, eyY + 1, 2, eyeD);
      circle(reX, eyY + 1, 2, eyeD);
      px(leX - 1, eyY + 3, eyeD); px(reX + 1, eyY + 3, eyeD);
      px(leX, eyY + 1, eyeHi); px(reX, eyY + 1, eyeHi);
    } else if (emo === 'disgust') {
      rect(leX - 1, eyY + 1, 4, 2, eyeD);
      rect(reX - 1, eyY + 1, 4, 2, eyeD);
    } else {
      circle(leX, eyY, 2, eyeD);
      circle(reX, eyY, 2, eyeD);
      px(leX + 1, eyY - 1, eyeHi); px(leX - 1, eyY + 1, eyeHi);
      px(reX + 1, eyY - 1, eyeHi); px(reX - 1, eyY + 1, eyeHi);
    }
  } else {
    rect(leX - 1, eyY + 1, 4, 1, eyeD);
    px(leX - 1, eyY, eyeD); px(leX + 2, eyY, eyeD);
    rect(reX - 1, eyY + 1, 4, 1, eyeD);
    px(reX - 1, eyY, eyeD); px(reX + 2, eyY, eyeD);
  }

  // ===== 腮红 =====
  circle(3, 15, 1, cheek);
  circle(14, 15, 1, cheek);
  if (emo === 'happy') {
    px(2, 14, cheek); px(15, 14, cheek);
  }

  // ===== 眼泪 =====
  if (emo === 'sad' && !isBlinking) {
    px(leX, eyY + 3, tearC);
    circle(leX - 1, eyY + 4, 1, tearC);
    px(leX, eyY + 4, tearHi);
    px(reX, eyY + 3, tearC);
    circle(reX + 1, eyY + 4, 1, tearC);
    px(reX, eyY + 4, tearHi);
  }

  // ===== 汗珠 =====
  if (emo === 'fear') {
    px(16, 8, sweatC);
    px(15, 9, sweatC); px(16, 9, sweatC);
    px(16, 10, sweatC);
    px(16, 7, sweatHi);
  }

  // ===== 嘴巴 =====
  const mY = 16;
  if (emo === 'happy') {
    rect(5, mY, 8, 1, mouthC);
    rect(4, mY + 1, 10, 2, mouthC);
    rect(5, mY + 3, 8, 1, mouthC);
    rect(6, mY + 1, 6, 1, teethC);
    rect(7, mY + 2, 4, 1, tongueC);
    px(4, mY, mouthC); px(13, mY, mouthC);
  } else if (emo === 'surprise') {
    circle(9, mY + 1, 2, mouthC);
    circle(9, mY + 1, 1, '#431407');
  } else if (emo === 'sad') {
    rect(6, mY, 6, 1, mouthC);
    rect(5, mY + 1, 8, 1, mouthC);
    rect(6, mY + 2, 6, 1, mouthC);
    px(4, mY + 2, mouthC); px(13, mY + 2, mouthC);
  } else if (emo === 'angry') {
    rect(6, mY, 6, 1, mouthC);
    rect(5, mY + 1, 8, 2, mouthC);
    rect(6, mY + 3, 6, 1, mouthC);
    rect(6, mY + 1, 2, 1, teethC);
    rect(10, mY + 1, 2, 1, teethC);
  } else if (emo === 'fear') {
    rect(6, mY, 6, 1, mouthC);
    px(5, mY + 1, mouthC); px(6, mY + 1, mouthC);
    rect(8, mY + 1, 2, 1, mouthC);
    px(11, mY + 1, mouthC); px(12, mY + 1, mouthC);
    rect(6, mY + 2, 6, 1, mouthC);
  } else if (emo === 'disgust') {
    rect(6, mY, 6, 1, mouthC);
    rect(5, mY + 1, 2, 1, mouthC);
    rect(9, mY + 1, 4, 1, mouthC);
    px(12, mY + 2, tongueC);
  } else {
    // 中性：可爱小w嘴
    rect(7, mY, 4, 1, mouthC);
    px(6, mY + 1, mouthC); px(11, mY + 1, mouthC);
    px(8, mY + 1, tongueC); px(9, mY + 1, tongueC);
  }

  // ===== 短圆手臂 =====
  rect(0, 13, 3, 4, bodyC.main);
  px(0, 13, bodyC.main);
  rect(0, 17, 3, 1, bodyC.sh);
  px(1, 13, bodyC.hi);
  rect(15, 13, 3, 4, bodyC.main);
  px(17, 13, bodyC.main);
  rect(15, 17, 3, 1, bodyC.sh);
  px(16, 13, bodyC.hi);

  // ===== 圆圆小脚 =====
  rect(5, 25, 4, 1, '#f59e0b'); rect(5, 25, 4, 1, '#fcd34d');
  px(4, 25, '#b45309'); px(9, 25, '#b45309');
  rect(9, 25, 4, 1, '#f59e0b'); rect(9, 25, 4, 1, '#fcd34d');
  px(8, 25, '#b45309'); px(13, 25, '#b45309');

  const s = Math.max(4, Math.floor(Math.min(cw / gridW, ch / gridH)));
  const ox = (cw - gridW * s) / 2;
  const oy = (ch - gridH * s) / 2 + studioSpriteStateRef.hopOffset * s;

  c.clearRect(0, 0, cw, ch);
  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(studioOffscreenCanvas, Math.round(ox), Math.round(oy), gridW * s, gridH * s);
  c.restore();
}

function initPixelSprite() {
  spriteCanvas = document.getElementById('pixel-sprite-canvas');
  if (!spriteCanvas) return;
  spriteCtx = spriteCanvas.getContext('2d');
  spriteCtx.imageSmoothingEnabled = false;
  resizeSpriteCanvas();
  window.addEventListener('resize', resizeSpriteCanvas);
  animateSprite();
}

function resizeSpriteCanvas() {
  if (!spriteCanvas) return;
  const parent = spriteCanvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const w = Math.max(200, Math.min(400, rect.width));
  const h = Math.max(220, Math.min(450, rect.height));
  spriteCanvas.width = w;
  spriteCanvas.height = h;
  if (spriteCtx) spriteCtx.imageSmoothingEnabled = false;
}

function setSpriteEmotion(emo) {
  spriteState.emotion = emo;
}

function animateSprite() {
  spriteState.breathePhase += 0.06;
  spriteState.blinkTimer++;
  
  if (spriteState.blinkTimer > 180) {
    spriteState.blinkPhase = Math.min(1, spriteState.blinkPhase + 0.15);
    if (spriteState.blinkPhase >= 1) {
      spriteState.blinkTimer = 160 + Math.random() * 60;
    }
  } else if (spriteState.blinkPhase > 0) {
    spriteState.blinkPhase = Math.max(0, spriteState.blinkPhase - 0.15);
    if (spriteState.blinkPhase <= 0) {
      spriteState.blinkTimer = 0;
    }
  }

  spriteState.hopOffset = Math.sin(spriteState.breathePhase) * 2;

  drawPixelSprite();
  spriteAnimId = requestAnimationFrame(animateSprite);
}

let mainOffscreenCanvas = null;
let mainOffscreenCtx = null;

function drawPixelSprite() {
  if (!spriteCtx || !spriteCanvas) return;
  const c = spriteCtx;
  const cw = spriteCanvas.width;
  const ch = spriteCanvas.height;

  if (!mainOffscreenCanvas) {
    mainOffscreenCanvas = document.createElement('canvas');
    mainOffscreenCanvas.width = SPRITE_W;
    mainOffscreenCanvas.height = SPRITE_H;
    mainOffscreenCtx = mainOffscreenCanvas.getContext('2d');
  }

  const oc = mainOffscreenCtx;
  oc.clearRect(0, 0, SPRITE_W, SPRITE_H);

  function px(x, y, color) {
    oc.fillStyle = color;
    oc.fillRect(x, y, 1, 1);
  }
  function rect(x, y, w, h, color) {
    oc.fillStyle = color;
    oc.fillRect(x, y, w, h);
  }

  // Helper: draw a filled circle (pixel art approximation)
  function circle(cx, cy, r, color) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r + r * 0.5) {
          px(cx + dx, cy + dy, color);
        }
      }
    }
  }

  const leafC = { top: '#4ade80', mid: '#22c55e', sh: '#15803d', hi: '#86efac' };
  const bodyC = { hi: '#fffbeb', main: '#fde68a', sh: '#f59e0b', out: '#78350f' };
  const clothC = { top: '#86efac', mid: '#4ade80', sh: '#16a34a', out: '#14532d', btn: '#22c55e' };
  const cheek = '#fb7185';
  const mouthC = '#92400e';
  const tongueC = '#fb7185';
  const teethC = '#ffffff';
  const eyeWhite = '#1c1917';
  const eyeHi = '#ffffff';
  const tearC = '#60a5fa';
  const tearHi = '#93c5fd';
  const sweatC = '#38bdf8';
  const sweatHi = '#bae6fd';
  const browC = '#78350f';

  const emo = spriteState.emotion;
  const blinkOff = Math.floor(spriteState.blinkPhase * 3);
  const isBlinking = blinkOff >= 3;

  // ===== 叶子（头顶三片）=====
  // 左叶
  rect(9, 1, 5, 3, leafC.sh); rect(10, 0, 4, 2, leafC.mid); rect(11, 0, 2, 1, leafC.top);
  px(11, 0, leafC.hi); px(12, 1, leafC.hi);
  // 中叶（最高）
  rect(14, 0, 5, 4, leafC.sh); rect(15, 0, 3, 3, leafC.mid); rect(15, 0, 2, 1, leafC.top);
  px(16, 0, leafC.hi); px(16, 1, leafC.hi);
  // 右叶
  rect(19, 1, 5, 3, leafC.sh); rect(19, 0, 4, 2, leafC.mid); rect(20, 0, 2, 1, leafC.top);
  px(20, 0, leafC.hi); px(21, 1, leafC.hi);
  // 叶柄
  rect(15, 4, 3, 1, leafC.sh);

  // ===== 身体（圆滚滚大团子）=====
  // 顶部圆弧（圆头）
  rect(10, 5, 12, 1, bodyC.out);
  rect(8, 6, 16, 1, bodyC.out);
  rect(6, 7, 20, 1, bodyC.out);
  rect(5, 8, 22, 1, bodyC.out);
  rect(4, 9, 24, 1, bodyC.out);
  // 主体填充（大圆脸+身体）
  for (let row = 0; row < 12; row++) rect(3, 10 + row, 26, 1, bodyC.main);
  // 衣服区域轮廓
  rect(4, 22, 24, 1, bodyC.out);
  rect(5, 23, 22, 1, bodyC.out);
  rect(6, 24, 20, 1, bodyC.out);
  // 衣服填充
  rect(6, 24, 20, 4, clothC.mid);
  rect(6, 24, 20, 1, clothC.top);
  rect(6, 27, 20, 1, clothC.sh);
  // 衣服底部圆弧
  rect(7, 28, 18, 1, clothC.out);
  rect(9, 29, 14, 1, clothC.out);
  rect(11, 30, 10, 1, clothC.out);

  // 高光（左上圆润光泽）
  rect(8, 7, 6, 1, bodyC.hi);
  rect(6, 8, 5, 1, bodyC.hi);
  rect(5, 9, 4, 1, bodyC.hi);
  rect(4, 10, 3, 2, bodyC.hi);
  rect(4, 12, 2, 1, bodyC.hi);
  // 阴影（右下）
  rect(25, 15, 2, 4, bodyC.sh);
  rect(24, 18, 3, 3, bodyC.sh);
  rect(23, 20, 3, 2, bodyC.sh);

  // 领子
  rect(10, 22, 12, 1, clothC.out);
  rect(11, 23, 10, 1, clothC.top);
  rect(15, 23, 2, 1, clothC.sh);
  // 衣服扣子
  rect(15, 25, 2, 2, clothC.btn);
  px(15, 25, '#bbf7d0');

  // ===== 眉毛 =====
  const browY = 10;
  if (emo === 'angry') {
    rect(6, browY, 6, 1, browC); px(5, browY + 1, browC);
    rect(20, browY, 6, 1, browC); px(26, browY + 1, browC);
  } else if (emo === 'sad') {
    rect(6, browY + 1, 6, 1, browC); px(11, browY, browC);
    rect(20, browY + 1, 6, 1, browC); px(20, browY, browC);
  } else if (emo === 'surprise' || emo === 'fear') {
    rect(8, browY - 1, 3, 1, browC); px(7, browY, browC);
    rect(21, browY - 1, 3, 1, browC); px(24, browY, browC);
  } else if (emo === 'disgust') {
    rect(7, browY, 4, 1, browC);
    rect(21, browY + 1, 4, 1, browC); px(20, browY + 2, browC);
  } else if (emo === 'happy') {
    // 开心时弯弯眉
    rect(8, browY + 1, 3, 1, browC); px(7, browY, browC); px(11, browY, browC);
    rect(21, browY + 1, 3, 1, browC); px(20, browY, browC); px(24, browY, browC);
  } else {
    // 中性：短小平眉
    rect(8, browY + 1, 3, 1, browC);
    rect(21, browY + 1, 3, 1, browC);
  }

  // ===== 眼睛（圆圆大眼）=====
  // 左眼中心 (10, 15)，右眼中心 (21, 15)，半径3
  const leX = 9, reX = 20;
  const eyY = 14;

  if (!isBlinking) {
    if (emo === 'happy') {
      // 笑眼：弯弯弧线 ^ ^
      px(leX - 1, eyY, eyeWhite); px(leX, eyY - 1, eyeWhite); px(leX + 1, eyY - 1, eyeWhite); px(leX + 2, eyY, eyeWhite);
      rect(leX - 2, eyY + 1, 5, 1, eyeWhite);
      px(reX - 1, eyY, eyeWhite); px(reX, eyY - 1, eyeWhite); px(reX + 1, eyY - 1, eyeWhite); px(reX + 2, eyY, eyeWhite);
      rect(reX - 2, eyY + 1, 5, 1, eyeWhite);
    } else if (emo === 'angry') {
      // 怒目：圆眼+上眼睑压低
      circle(leX, eyY + 1, 3, '#000');
      circle(reX, eyY + 1, 3, '#000');
      px(leX, eyY + 2, '#ef4444'); px(reX, eyY + 2, '#ef4444');
      px(leX + 1, eyY + 1, eyeHi); px(reX + 1, eyY + 1, eyeHi);
      // 上眼睑黑线
      rect(leX - 3, eyY - 1, 6, 1, browC);
      rect(reX - 3, eyY - 1, 6, 1, browC);
    } else if (emo === 'surprise') {
      // 惊讶：超大圆眼
      circle(leX, eyY, 3, eyeWhite);
      circle(reX, eyY, 3, eyeWhite);
      px(leX, eyY, eyeHi); px(reX, eyY, eyeHi);
      px(leX - 1, eyY - 1, eyeHi); px(reX - 1, eyY - 1, eyeHi);
    } else if (emo === 'fear') {
      // 恐惧：瞪大眼+小瞳孔
      circle(leX, eyY, 3, eyeWhite);
      circle(reX, eyY, 3, eyeWhite);
      // 小瞳孔
      px(leX, eyY + 1, eyeHi); px(reX, eyY + 1, eyeHi);
      rect(leX - 1, eyY, 2, 1, eyeHi);
      rect(reX - 1, eyY, 2, 1, eyeHi);
    } else if (emo === 'sad') {
      // 悲伤：下垂圆眼
      circle(leX, eyY + 1, 2, eyeWhite);
      circle(reX, eyY + 1, 2, eyeWhite);
      px(leX - 1, eyY + 3, eyeWhite); px(reX + 1, eyY + 3, eyeWhite);
      px(leX, eyY + 1, eyeHi); px(reX, eyY + 1, eyeHi);
    } else if (emo === 'disgust') {
      // 厌恶：眯成横线
      rect(leX - 2, eyY + 1, 5, 2, eyeWhite);
      rect(reX - 2, eyY + 1, 5, 2, eyeWhite);
      px(leX - 1, eyY + 1, eyeHi); px(reX - 1, eyY + 1, eyeHi);
    } else {
      // 中性：圆滚滚大眼（默认可爱状态）
      circle(leX, eyY, 3, eyeWhite);
      circle(reX, eyY, 3, eyeWhite);
      // 大眼睛高光（两个点更闪亮）
      px(leX + 1, eyY - 1, eyeHi); px(leX - 1, eyY + 1, eyeHi);
      px(reX + 1, eyY - 1, eyeHi); px(reX - 1, eyY + 1, eyeHi);
    }
  } else {
    // 眨眼：弯弯弧线
    rect(leX - 2, eyY + 1, 5, 1, eyeWhite);
    px(leX - 1, eyY, eyeWhite); px(leX + 2, eyY, eyeWhite);
    rect(reX - 2, eyY + 1, 5, 1, eyeWhite);
    px(reX - 1, eyY, eyeWhite); px(reX + 2, eyY, eyeWhite);
  }

  // ===== 腮红（圆圆粉脸蛋）=====
  if (emo === 'happy') {
    // 开心时腮红更大更圆
    circle(5, 18, 2, cheek); circle(26, 18, 2, cheek);
    px(4, 17, cheek); px(27, 17, cheek);
  } else {
    circle(5, 18, 2, cheek);
    circle(26, 18, 2, cheek);
  }

  // ===== 眼泪（悲伤时：圆滚滚的泪珠）=====
  if (emo === 'sad' && !isBlinking) {
    // 左眼泪
    px(leX, eyY + 4, tearC);
    circle(leX - 1, eyY + 5, 1, tearC);
    px(leX, eyY + 7, tearC);
    px(leX, eyY + 4, tearHi);
    // 右眼泪
    px(reX, eyY + 4, tearC);
    circle(reX + 1, eyY + 5, 1, tearC);
    px(reX, eyY + 7, tearC);
    px(reX, eyY + 4, tearHi);
  }

  // ===== 汗珠（恐惧时）=====
  if (emo === 'fear') {
    px(28, 9, sweatC);
    circle(27, 10, 1, sweatC);
    px(28, 12, sweatC);
    px(28, 8, sweatHi);
  }

  // ===== 嘴巴 =====
  const mY = 19;
  if (emo === 'happy') {
    // 大笑：宽开口笑 + 一排白牙 + 粉舌头
    rect(11, mY, 10, 1, mouthC);
    rect(10, mY + 1, 12, 2, mouthC);
    rect(11, mY + 3, 10, 1, mouthC);
    // 一排白牙
    rect(12, mY + 1, 8, 1, teethC);
    // 小舌头
    rect(13, mY + 2, 6, 1, tongueC);
    rect(14, mY + 2, 4, 1, '#f43f5e');
    // 嘴角上扬
    px(10, mY, mouthC); px(21, mY, mouthC);
  } else if (emo === 'surprise') {
    // 惊讶：小圆O嘴
    circle(16, mY + 1, 2, mouthC);
    rect(15, mY, 2, 1, mouthC);
    rect(15, mY + 3, 2, 1, mouthC);
    circle(16, mY + 1, 1, '#431407');
  } else if (emo === 'sad') {
    // 悲伤：下弯哭嘴
    rect(12, mY, 8, 1, mouthC);
    rect(11, mY + 1, 10, 1, mouthC);
    rect(12, mY + 2, 8, 1, mouthC);
    // 嘴角下垂
    px(10, mY + 2, mouthC); px(21, mY + 2, mouthC);
  } else if (emo === 'angry') {
    // 愤怒：咬牙切齿的方嘴
    rect(12, mY, 8, 1, mouthC);
    rect(11, mY + 1, 10, 2, mouthC);
    rect(12, mY + 3, 8, 1, mouthC);
    // 咬紧的牙齿（分两段）
    rect(13, mY + 1, 3, 1, teethC);
    rect(16, mY + 1, 4, 1, teethC);
    // 牙缝
    px(16, mY + 1, mouthC); px(16, mY + 2, mouthC);
  } else if (emo === 'fear') {
    // 恐惧：颤抖波浪嘴
    rect(12, mY, 8, 1, mouthC);
    px(11, mY + 1, mouthC); px(12, mY + 1, mouthC);
    rect(14, mY + 1, 3, 1, mouthC);
    px(18, mY + 1, mouthC); px(19, mY + 1, mouthC);
    rect(12, mY + 2, 8, 1, mouthC);
  } else if (emo === 'disgust') {
    // 厌恶：歪嘴+小舌头吐出
    rect(12, mY, 8, 1, mouthC);
    rect(11, mY + 1, 3, 1, mouthC);
    rect(16, mY + 1, 4, 1, mouthC);
    px(20, mY + 2, tongueC); px(20, mY + 3, tongueC);
  } else {
    // 中性：可爱小w嘴（像猫咪嘴 "3"）
    rect(14, mY, 4, 1, mouthC);
    px(13, mY + 1, mouthC); px(18, mY + 1, mouthC);
    px(15, mY + 1, tongueC); px(16, mY + 1, tongueC);
  }

  // ===== 手臂（短短圆圆的）=====
  // 左臂
  rect(1, 17, 3, 4, bodyC.main);
  px(0, 18, bodyC.main); px(0, 19, bodyC.main); px(0, 20, bodyC.main);
  rect(1, 21, 3, 1, bodyC.sh);
  px(1, 17, bodyC.hi);
  // 右臂
  rect(28, 17, 3, 4, bodyC.main);
  px(31, 18, bodyC.main); px(31, 19, bodyC.main); px(31, 20, bodyC.main);
  rect(28, 21, 3, 1, bodyC.sh);
  px(30, 17, bodyC.hi);

  // ===== 脚（圆圆小短脚）=====
  // 左脚
  rect(10, 31, 5, 2, '#f59e0b');
  rect(10, 31, 5, 1, '#fcd34d');
  rect(10, 32, 5, 1, '#b45309');
  px(9, 32, '#b45309'); px(15, 32, '#b45309');
  // 右脚
  rect(17, 31, 5, 2, '#f59e0b');
  rect(17, 31, 5, 1, '#fcd34d');
  rect(17, 32, 5, 1, '#b45309');
  px(16, 32, '#b45309'); px(22, 32, '#b45309');

  const s = Math.max(4, Math.floor(Math.min(cw / (SPRITE_W + 4), ch / (SPRITE_H + 4))));
  const offsetX = (cw - SPRITE_W * s) / 2;
  const offsetY = (ch - SPRITE_H * s) / 2 + spriteState.hopOffset * s;

  c.clearRect(0, 0, cw, ch);
  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(mainOffscreenCanvas, Math.round(offsetX), Math.round(offsetY), SPRITE_W * s, SPRITE_H * s);
  c.restore();
}

function drawStar(c, cx, cy, size) {
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const x = cx + Math.cos(angle) * size;
    const y = cy + Math.sin(angle) * size;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fill();
}

// ==========================================
// 11. 情绪时序分析折线图 (Multi-line Chart)
// ==========================================

const CHART_COLORS = {
  happy:    { line: '#fde047', glow: 'rgba(253,224,71,0.6)',  label: '开心', icon: '😄' },
  sad:      { line: '#60a5fa', glow: 'rgba(96,165,250,0.6)',   label: '悲伤', icon: '😢' },
  angry:    { line: '#ef4444', glow: 'rgba(239,68,68,0.6)',    label: '愤怒', icon: '😠' },
  surprise: { line: '#f59e0b', glow: 'rgba(245,158,11,0.6)',   label: '惊讶', icon: '😲' },
  fear:     { line: '#8b5cf6', glow: 'rgba(139,92,246,0.6)',   label: '恐惧', icon: '😨' },
  disgust:  { line: '#a855f7', glow: 'rgba(168,85,247,0.6)',   label: '厌恶', icon: '🤢' },
  neutral:  { line: '#9ca3af', glow: 'rgba(156,163,175,0.6)',  label: '中性', icon: '😐' },
};

function initEmotionChart() {
  chartCanvas = document.getElementById('emotion-chart-canvas');
  if (!chartCanvas) return;
  resizeChartCanvas();
  window.addEventListener('resize', () => {
    resizeChartCanvas();
    drawEmotionChart();
  });
  drawEmotionChart();
}

function resizeChartCanvas() {
  if (!chartCanvas) return;
  const parent = chartCanvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  chartCanvas.width = rect.width * dpr;
  chartCanvas.height = rect.height * dpr;
  chartCanvas.style.width = rect.width + 'px';
  chartCanvas.style.height = rect.height + 'px';
}

function startChartRender() {
  drawEmotionChart();
}

function stopChartRender() {
  drawEmotionChart();
}

function drawEmotionChart() {
  if (!chartCanvas) return;
  const c = chartCanvas.getContext('2d');
  const w = chartCanvas.width;
  const h = chartCanvas.height;
  const dpr = window.devicePixelRatio || 1;

  c.clearRect(0, 0, w, h);

  const padding = { top: 28 * dpr, right: 70 * dpr, bottom: 28 * dpr, left: 42 * dpr };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  if (plotW <= 0 || plotH <= 0) return;

  c.save();
  c.scale(dpr, dpr);
  const pw = plotW / dpr;
  const ph = plotH / dpr;
  const px = padding.left / dpr;
  const py = padding.top / dpr;

  const yMin = 0;
  const yMax = 100;
  const ySteps = 5;

  const data = emotionTimeline;
  const hasData = data.length > 0;
  const maxX = hasData ? Math.max(30, data[data.length - 1].sec) : 30;

  // 网格
  c.strokeStyle = 'rgba(234,179,8,0.12)';
  c.lineWidth = 0.5;
  for (let i = 0; i <= ySteps; i++) {
    const y = py + (ph / ySteps) * i;
    c.beginPath();
    c.moveTo(px, y);
    c.lineTo(px + pw, y);
    c.stroke();
  }
  for (let t = 0; t <= maxX; t += 10) {
    const x = px + (t / maxX) * pw;
    c.beginPath();
    c.moveTo(x, py);
    c.lineTo(x, py + ph);
    c.stroke();
  }

  // 边框
  c.strokeStyle = 'rgba(234,179,8,0.25)';
  c.lineWidth = 1.5;
  c.strokeRect(px, py, pw, ph);

  // Y轴标签
  c.fillStyle = 'rgba(255,255,255,0.45)';
  c.font = '9px "Fusion Pixel", monospace';
  c.textAlign = 'right';
  for (let i = 0; i <= ySteps; i++) {
    const val = yMax - (yMax / ySteps) * i;
    const y = py + (ph / ySteps) * i;
    c.fillText(val + '%', px - 8, y + 3);
  }

  // X轴标签
  c.textAlign = 'center';
  for (let t = 0; t <= maxX; t += 10) {
    const x = px + (t / maxX) * pw;
    if (x <= px + pw) {
      c.fillText(t + 's', x, py + ph + 15);
    }
  }

  // 图例
  const legendX = px + pw + 10;
  const chartEmotions = ['happy', 'sad', 'angry', 'surprise', 'fear', 'disgust', 'neutral'];
  chartEmotions.forEach((key, i) => {
    const ly = py + i * 16;
    c.fillStyle = CHART_COLORS[key].line;
    c.fillRect(legendX, ly, 8, 8);
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = '9px "Fusion Pixel", monospace';
    c.textAlign = 'left';
    c.fillText(CHART_COLORS[key].label, legendX + 12, ly + 8);
  });

  if (!hasData) {
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.font = '14px "Fusion Pixel", monospace';
    c.textAlign = 'center';
    c.fillText('等待情绪数据...', px + pw / 2, py + ph / 2);
    c.restore();
    return;
  }

  // 绘制各情绪平滑曲线
  chartEmotions.forEach(key => {
    const color = CHART_COLORS[key];
    const points = [];
    data.forEach(d => {
      const x = px + (d.sec / maxX) * pw;
      const val = d.probs ? (d.probs[key] || 0) * 100 : 0;
      const y = py + ph - (val / (yMax - yMin)) * ph;
      points.push({ x, y });
    });

    if (points.length < 2) return;

    // 发光层
    c.save();
    c.shadowColor = color.glow;
    c.shadowBlur = 6;
    c.strokeStyle = color.line;
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < points.length; i++) {
      const prevX = i > 0 ? points[i - 1].x : points[i].x;
      const prevY = i > 0 ? points[i - 1].y : points[i].y;
      const cx1 = prevX + (points[i].x - prevX) * 0.5;
      if (i === 0) c.moveTo(points[i].x, points[i].y);
      else c.bezierCurveTo(cx1, prevY, cx1, points[i].y, points[i].x, points[i].y);
    }
    c.stroke();
    c.restore();

    // 数据点
    points.forEach(pt => {
      c.fillStyle = color.line;
      c.beginPath();
      c.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      c.fill();
    });
  });

  c.restore();
}

// ==========================================
// 12. AI 情绪顾问 (DeepSeek API)
// ==========================================

function openAiSuggestionModal() {
  const modal = document.getElementById('ai-suggestion-modal');
  const modalContent = document.getElementById('ai-modal-body-content');
  if (!modal || !modalContent) return;

  if (typeof playChiptuneNote === 'function') {
    playChiptuneNote(800, null, 0.15, 'sine', 0.08);
  }

  modal.classList.add('active');

  // 如果已有缓存的分析结果，直接使用，避免重复请求
  if (lastAiSuggestionResult) {
    modalContent.innerHTML = formatMarkdownToHTML(lastAiSuggestionResult);
    return;
  }

  // 否则，展示复古 Loading 动画
  modalContent.innerHTML = `
    <div class="ai-loading-container">
      <div class="ai-retro-spinner"></div>
      <div class="ai-loading-text">正在向宇宙边缘的 AI 情绪站发送电波...</div>
    </div>
  `;

  fetchAiSuggestionsFromDeepSeek()
    .then(text => {
      lastAiSuggestionResult = text;
      modalContent.innerHTML = formatMarkdownToHTML(text);
      if (typeof playChiptuneNote === 'function') {
        playChiptuneNote(1000, null, 0.2, 'sine', 0.1);
      }
    })
    .catch(err => {
      console.error("DeepSeek API error:", err);
      modalContent.innerHTML = `
        <div class="ai-error-container">
          <div class="ai-error-icon">📡❌</div>
          <div class="ai-loading-text" style="color: var(--color-pink);">电波受强太阳风暴干扰，传输中断！</div>
          <button class="btn btn-ctrl" id="btn-ai-retry" style="width: auto; margin-top: 10px;">
            <span class="btn-border" style="border-color: var(--color-pink);"></span>
            <span class="btn-text" style="font-size: 12px; padding: 6px 12px;"><i class="fa-solid fa-rotate-right"></i> 重新连接</span>
          </button>
        </div>
      `;
      // 绑定重试按钮
      const retryBtn = document.getElementById('btn-ai-retry');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          openAiSuggestionModal();
        });
      }
    });
}

function fetchAiSuggestionsFromDeepSeek() {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY || '';
  
  // 汇总情绪频次统计
  let statsSummary = Object.entries(emotionHistory)
    .filter(([_, count]) => count > 0)
    .map(([emo, count]) => {
      const translation = {
        happy: '开心 😃',
        sad: '悲伤 😢',
        angry: '愤怒 😠',
        surprise: '惊讶 😲',
        fear: '恐惧 😨',
        disgust: '厌恶 🤢',
        neutral: '平静 😐'
      }[emo] || emo;
      return `- ${translation}: ${count} 次`;
    })
    .join('\n');

  // 压缩时间线，最多采样 20 个点，避免 prompt 过大
  let sampledTimeline = [];
  const totalSecs = emotionTimeline.length;
  if (totalSecs <= 20) {
    sampledTimeline = emotionTimeline;
  } else {
    for (let i = 0; i < 20; i++) {
      const index = Math.floor((i / 19) * (totalSecs - 1));
      sampledTimeline.push(emotionTimeline[index]);
    }
  }

  let timelineSummary = sampledTimeline
    .map(t => `第 ${t.sec} 秒: ${t.icon} (置信度 ${t.prob}%)`)
    .join('\n');

  const dominantRole = document.getElementById('role-name')?.textContent || '观察者';

  const systemPrompt = `You are a psychological and emotion analysis assistant. 
Please analyze the user's emotion trajectory and history data from their recording, and write a warm, empathetic, retro-styled psychological analysis report.

The output MUST contain:
1. "### 本次情绪轨迹分析" (A detailed narrative summary of how their emotions shifted over time. Use retro/poetic or warm gaming-themed metaphors to describe their state transition).
2. "### 情绪画像建议" (Empathetic and interesting mental health or lifestyle suggestions matching their emotional states, e.g. what kind of pixel game to play, chiptune note to listen to, or simple cozy habits. Keep it supportive).

Format your output in clean Markdown using headings, lists, and bold text. Keep the tone very personalized, friendly, and consistent with a retro arcade / CRT theme. Please reply in Chinese.`;

  const userPrompt = `本次录制总时长: ${totalSecs}秒
生成的情绪角色卡: 【${dominantRole}】

情绪频次统计:
${statsSummary}

情绪时序轨迹样本:
${timelineSummary}`;

  return fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 800
    })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content;
    }
    throw new Error("Invalid response format from API");
  });
}

function formatMarkdownToHTML(markdownText) {
  let html = markdownText;
  
  // 转义基础 HTML 标记防注入
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  // 粗体: **text** -> <strong>text</strong>
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // 列表: - item -> div with advice-item class
  html = html.replace(/^[-\*]\s+(.*?)$/gm, '<div class="ai-result-advice-item">$1</div>');

  // 三级标题: ### text -> section title
  html = html.replace(/^###\s+(.*?)$/gm, '<div class="ai-result-section-title">$1</div>');
  
  // 二级标题: ## text -> section title with styling
  html = html.replace(/^##\s+(.*?)$/gm, '<div class="ai-result-section-title" style="font-size: 14px; color: var(--color-cyan); border-color: rgba(234,179,8,0.3);">$1</div>');
  
  // 一级标题: # text -> centered section title
  html = html.replace(/^#\s+(.*?)$/gm, '<div class="ai-result-section-title" style="font-size: 15px; text-align: center; color: var(--color-cyan);">$1</div>');

  return `<div class="ai-result-content">${html}</div>`;
}
