# MindLens 心镜 👾 (EMO RETRO ARCADE)

> **NextStep 黑客松参赛作品**
> 
> *“今天你 Emo 了吗？” —— 捕捉你的情绪瞬间，定格复古浪漫。*

---

## 📌 项目背景与介绍

**MindLens 心镜** 是一款融合了 **复古街机/CRT终端美学** 与 **现代人脸 AI 识别技术** 的情绪诊断与互动网页应用。本项目作为 **NextStep 黑客松** 的参赛作品，旨在通过趣味性、互动性极强的复古像素风与 8-Bit 声音合成引擎，引导用户感知、定格并调解自己的情绪状态。

用户可以通过“悲浪舱”选择两种不同的情绪观测形式：
1. **情绪照相馆**：通过人脸识别与面部表情混合权重，定格此刻表情并添加可拖拽、缩放的像素风贴纸与矫情语录，导出专属的 Polaroid 拍立得表情包。
2. **情绪摄影机**：开启后实时绘制面部网格与表情包，记录一段时间内情绪的时序波动，最终生成一张精美定制的“情绪角色卡”，并支持生成 AI 情绪诊断建议与观察报告（由 DeepSeek 强力驱动）。

---

## 🛠️ 技术栈

- **核心架构**: HTML5 / ES6 Javascript / CSS3
- **前端工具链**: Vite (v8.1)
- **AI 与人脸识别**: `@mediapipe/tasks-vision` (Face Landmarker / Blendshapes)
- **情绪观察顾问**: DeepSeek API (`deepseek-chat`)
- **音频引擎**: Web Audio API (实时合成 8-Bit Chiptune 旋律与打字机、快门等音效)
- **视觉风格**: Fusion Pixel 像素字 / Font Awesome 矢量图标 / CRT 扫描线与噪点效果 / 逼真木质街机外框

---

## 🚀 性能优化 (Performance Optimization)

在项目交付前，我们对渲染引擎进行了深度的重构与调优，在 **不改变任何现有表现效果与视觉质感** 的基础上，解决了高密度渲染下的卡顿问题，FPS 稳定在 60 帧：

1. **背景 Emoji 流星雨缓冲优化 (Canvas Caching)**:
   - *问题*: 原版在 Emo Mode 下会同时渲染 140 颗 Emoji 粒子，每个粒子每帧都在调用 `ctx.shadowBlur` 滤镜和 `ctx.fillText` 绘制多色矢量表情，导致极高的 GPU 栅格化负担与 CPU 阻塞。
   - *优化*: 将每个 Emoji 连同其发光阴影在初始化/重置时，**一次性预渲染**到私有的离线 Canvas 中。在 60FPS 渲染主循环中，只调用高性能、硬件加速的 `ctx.drawImage`，性能提升数倍。
   
2. **距离平方规避开方 (Squared Proximity Optimization)**:
   - *问题*: 每帧都要针对全部 140 颗粒子计算与鼠标的欧氏距离 `Math.sqrt(dx * dx + dy * dy)` 以产生排斥效果，造成冗余的浮点运算。
   - *优化*: 引入距离平方检查机制 (`distSq < 10000`)。仅当鼠标指针进入粒子 100px 范围以内时，才会执行 `Math.sqrt` 计算，其余时间均使用极低成本的平方比对，释放 CPU 计算周期。

3. **像素小精灵离线像素化绘制 (Offscreen Pixel Sprite Rendering)**:
   - *问题*: AI 小精灵每帧都在以百余次 `c.fillRect(x * s, y * s, s, s)` 强行在主 Canvas 上绘制大尺寸像素块，渲染负荷与组件分辨率成正比。
   - *优化*: 创建一个与小精灵网格等大（如 18x26、32x38）的 native 1x1 离线 Canvas。首先在该离线画布上完成廉价的 1x1 填色，接着利用 GPU 以 `imageSmoothingEnabled = false` 一次性进行拉伸渲染，在确保边缘锐利不模糊的同时，几乎不占用 CPU 资源。

4. **折线图渲染节流 (Chart Render Throttling)**:
   - *问题*: 折线图此前在 `requestAnimationFrame` 中被每秒重绘 60 次，但时序数据实际上最多 1 秒才会更新一次。
   - *优化*: 彻底移除折线图的 60FPS 渲染 loop，仅在 timeline 产生数据变化（即每秒钟 detection 更新时）或窗口尺寸改变（resize）时，触发单次重绘。

5. **FPS 显示计数器节流 (UI DOM Throttling)**:
   - *问题*: 帧率计数器原本使用 `timestamp % 10 === 0` 条件触发更新，导致浮点数取模判断失灵或产生高强度的 DOM 重绘。
   - *优化*: 调整为帧数计数控制，每 30 帧（约 500ms）更新一次 DOM，极大减少了页面的重绘回流（Reflow & Repaint）。

---

## ⚙️ 本地快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发服务器
```bash
npm run dev
```
启动后访问控制台输出的地址（如 `http://localhost:5173/`）即可。

### 3. 构建生产包
```bash
npm run build
```
编译产物将输出在 `dist` 目录。
