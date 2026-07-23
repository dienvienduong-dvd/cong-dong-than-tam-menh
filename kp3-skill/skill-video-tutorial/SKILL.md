---
name: video-tutorial-maker
description: >
  Tạo video tutorial dạng animated slideshow từ một chủ đề bất kỳ.
  Workflow: hỏi kịch bản → tạo storyboard → build animated slideshow (HTML hoặc Remotion React → MP4).
  Dùng skill này khi user muốn: "tạo video tutorial", "làm slide tutorial", "video hướng dẫn",
  "animated slideshow", "video giải thích", "tutorial video", hoặc nhắc đến chủ đề + video/slide.
  Luôn dùng skill này trước khi bắt tay làm bất kỳ video tutorial nào — kể cả khi chủ đề đơn giản.
---

# Skill: Video Tutorial Maker

Tạo animated tutorial video từ chủ đề bất kỳ — qua 4 giai đoạn rõ ràng.

---

## Giai đoạn 1 — Nhận chủ đề & hỏi kịch bản

Khi user đưa ra chủ đề, hỏi ngay:

> "Bạn đã có kịch bản/script cho video này chưa?"

**Nếu CÓ kịch bản** → user paste vào hoặc upload file → chuyển sang Giai đoạn 2.

**Nếu CHƯA có kịch bản**, hỏi tiếp:

> "Bạn muốn AI tự tạo kịch bản hay bạn sẽ viết?"

- **AI tự tạo**: Hỏi thêm:
  - Đối tượng xem là ai? (người mới / người có kinh nghiệm)
  - Tone: nghiêm túc / thân thiện / hài hước?
  - Độ dài mong muốn? (ngắn <2 phút / trung bình 3-5 phút / dài >5 phút)
  - Có avatar/hình ảnh muốn đưa vào không? (upload nếu có)
  - Rồi AI tự tạo kịch bản đầy đủ và xác nhận với user trước khi tiếp tục.

- **User tự viết**: Chờ user upload hoặc paste nội dung.

---

## Giai đoạn 2 — Tạo Storyboard

Từ kịch bản, chia thành **6-10 slides** theo cấu trúc:

```
Slide 1: Intro     — Tiêu đề + avatar (nếu có) + tagline
Slide 2-N: Steps   — Mỗi bước 1 slide, có animation minh hoạ
Slide N: Done/CTA  — Kết thúc + avatar + call to action
```

Trình bày storyboard dạng bảng:

| # | Tiêu đề | Nội dung hiển thị | Animation |
|---|---------|-------------------|-----------|
| 1 | Intro   | ...               | ...       |
| 2 | Bước 1  | ...               | ...       |

Xác nhận với user trước khi build.

---

## Giai đoạn 3 — Hỏi output format

```
Bạn muốn output dạng nào?
A) HTML slideshow — chạy thẳng trên browser, dễ record thành video
B) Remotion project — render ra file MP4 chuẩn (cần Node.js)
```

---

## Giai đoạn 4 — Build

### Option A: HTML Animated Slideshow

Tạo **1 file `.jsx` artifact** (React) với:

**Cấu trúc bắt buộc:**
- Tỷ lệ mặc định: **9:16** (dọc, cho Reels/Shorts/TikTok) — hỏi nếu user muốn 16:9
- Mỗi slide là 1 SVG illustration vẽ bằng code (không dùng ảnh ngoài, trừ avatar do user upload)
- Animation dùng CSS keyframes + React state + setTimeout
- Có nút điều hướng (Trước/Tiếp), dot indicators, nút "Tự động chuyển"
- Phím tắt ← → để chuyển slide

**Palette màu mặc định (tech/AI theme):**
```
background: linear-gradient(160deg, #0f172a, #1e1b4b, #0f172a)
accent:     #7c3aed  (purple)
text:       #e2e8f0 / #94a3b8
card:       rgba(30,41,59,0.8) + border rgba(124,58,237,0.3)
success:    #22c55e
```

**Avatar (nếu có):**
- Slide Intro: avatar hiện ra với spring animation, circle crop, orbiting dots
- Slide Done: avatar xuất hiện sau khi content hiện, kèm confetti particles
- Dùng `<image href="avatar.png" clipPath="url(#clip)" />`

**Mỗi slide type có animation đặc trưng:**

| Type | Animation |
|------|-----------|
| intro | Logo/avatar scale spring + orbit dots xoay |
| browser | Typing URL animation + cursor di chuyển + button pulse |
| form/signup | Fields highlight lần lượt theo step |
| email | Email "mở ra" sau delay + button glow |
| download | Progress bar chạy thật từ 0→100% |
| install | Drag & drop animation |
| login | Form → success state transition |
| done | Scale spring + confetti particles + avatar reveal |

**Transition giữa slides:** fade in/out 300ms.

### Option B: Remotion Project

Tạo các file:
- `src/Root.jsx` — Composition với width=720, height=1280, fps=30
- `src/index.jsx` — registerRoot
- `src/ClaudeTutorial.jsx` — Main component dùng `useCurrentFrame`, `spring`, `interpolate`
- `public/avatar.png` — copy từ upload của user
- `package.json` — scripts: `start` (remotion studio) và `render` (remotion render → out/video.mp4)

**Timing:** mỗi slide = 150 frames (5 giây ở 30fps). Tổng = N slides × 150 frames.

**Animation trong Remotion:**
- Dùng `spring({ frame: f, fps: FPS, config: { damping: 14 } })` cho scale/appear
- Dùng `interpolate(f, [start, end], [from, to], { extrapolateRight: "clamp" })` cho motion
- Fade: `interpolate(slideFrame, [0,12], [0,1])` vào và `interpolate(slideFrame, [138,150], [1,0])` ra

**Sau khi tạo file**, đóng gói:
```bash
mkdir -p /home/claude/<project-name>/public
# copy avatar nếu có
cp /mnt/user-data/uploads/<avatar-file> /home/claude/<project-name>/public/avatar.png
tar --exclude='<project-name>/node_modules' -czf <project-name>.tar.gz <project-name>/
cp <project-name>.tar.gz /mnt/user-data/outputs/
```

Hướng dẫn user chạy trên PC:
```powershell
# Windows PowerShell:
tar -xzf "$env:USERPROFILE\Downloads\<project>.tar.gz" -C "$env:USERPROFILE\Downloads\"
cd "$env:USERPROFILE\Downloads\<project-name>"
npm install
npm start    # preview tại localhost:3000
npm run render  # xuất MP4 → out/video.mp4
```

---

## Nhạc nền (tuỳ chọn)

Nếu user hỏi về nhạc, gợi ý:
- **Pixabay** (pixabay.com/music) — CC0, không cần credit, tìm "lo-fi tutorial"
- **Mixkit** (mixkit.co/free-stock-music) — miễn phí, filter "Tech" hoặc "Chill"
- **Suno AI** (suno.com) — AI tạo nhạc theo prompt, royalty-free

Prompt Suno gợi ý cho tutorial tech:
> "lo-fi chill background music, light tech tutorial vibe, no vocals, upbeat but calm, 60 seconds"

---

## Lưu ý quan trọng

1. **Không dùng ảnh từ internet** — tất cả illustration vẽ bằng SVG code
2. **Avatar user upload** → dùng trực tiếp, clip thành circle
3. **Tỷ lệ 9:16 mặc định** cho social video — hỏi nếu muốn khác
4. **Hỏi xác nhận storyboard** trước khi code — tiết kiệm thời gian sửa
5. **Remotion cần Node.js 18+** — nhắc user cài tại nodejs.org nếu chưa có
6. **Domain remotion.media bị chặn** trong môi trường Claude — render phải chạy trên máy user
