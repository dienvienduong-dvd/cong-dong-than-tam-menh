---
name: he-sinh-thai-so
description: |
  Dùng skill này khi khách hàng cung cấp thông tin sản phẩm hoặc dịch vụ và muốn xây dựng hệ sinh thái sản phẩm số hoàn chỉnh theo mô hình Alex Hormozi ($100M Offers, $100M Leads). Skill này hướng dẫn AI đặt câu hỏi khai thác thông tin sản phẩm, phân tích Core Offer, rồi tự động thiết kế toàn bộ 5 tầng sản phẩm số (thu hút → core → upsell → downsell → retention), bao gồm tên sản phẩm, mô tả, giá, cách số hóa, và kịch bản bán hàng cụ thể. Kích hoạt khi người dùng nói: "tôi có sản phẩm X muốn số hóa", "giúp tôi tạo hệ sinh thái sản phẩm", "tôi bán dịch vụ Y muốn có nhiều tầng sản phẩm", "làm sao nhân bản sản phẩm của tôi", hoặc bất kỳ yêu cầu nào liên quan đến mở rộng / nhân bản / tạo thêm sản phẩm từ một sản phẩm hoặc dịch vụ gốc.
---

# SKILL: Xây dựng Hệ Sinh Thái Sản Phẩm Số
# Dựa trên framework $100M Offers — Alex Hormozi

## ĐỌC TRƯỚC KHI THỰC HIỆN

Đọc toàn bộ 5 file references trước khi bắt đầu bất kỳ bước nào:
- `references/hormozi-framework.md`     — Công thức Value, Grand Slam, Guarantee
- `references/product-tiers.md`         — Logic 7 tầng + móc chuyển đổi
- `references/product-matrix.md`        — Ma trận 3 chiều sinh sản phẩm + ví dụ ngành
- `references/pricing-vietnam.md`       — Ngưỡng giá chuẩn thị trường VN
- `references/digitize-formats.md`      — Cách số hóa từng loại sản phẩm

---

## NGUYÊN TẮC GỐC — NẮM TRƯỚC KHI LÀM

1. **Core Offer là trung tâm** — không phải điểm bắt đầu của phễu. Mọi sản phẩm khác đều được tách ra hoặc mở rộng từ Core Offer, không tạo mới hoàn toàn.

2. **Hành trình A→B là xương sống** — toàn bộ hệ sinh thái nằm dọc theo hành trình từ vấn đề (điểm A) đến kết quả (điểm B) của khách hàng.

3. **Không bán giá — bán giá trị cảm nhận** — mỗi tầng phải có Value Stack rõ ràng, Guarantee loại bỏ rủi ro.

4. **Xây đúng thứ tự** — Core trước, Lead Magnet sau, Downsell tiếp, Upsell khi có proof, Retention khi có cộng đồng.

5. **Số hóa = tạo ra được ngay** — mỗi sản phẩm phải kèm công cụ cụ thể + ước tính thời gian tạo.

---

## QUY TRÌNH 6 BƯỚC

---

### BƯỚC 1 — KHAI THÁC THÔNG TIN

Hỏi khách hàng theo 2 nhóm. Không hỏi hết một lúc — hỏi nhóm A trước, nhận trả lời, rồi hỏi nhóm B.

**Nhóm A — Sản phẩm gốc:**
> "Bạn đang có sản phẩm / dịch vụ gì? Hãy mô tả chi tiết nhất có thể:
> 1. Sản phẩm là gì, bạn đang làm gì cho khách hàng?
> 2. Khách hàng nhận được kết quả gì sau khi dùng? (cụ thể, đo được)
> 3. Giá hiện tại đang bán là bao nhiêu?"

**Nhóm B — Khách hàng:**
> "Thêm vài câu để mình hiểu khách hàng của bạn:
> 4. Khách hàng lý tưởng là ai? (tuổi, nghề, vấn đề họ đang gặp)
> 5. Nỗi đau lớn nhất họ muốn giải quyết là gì?
> 6. Họ thường tiếp cận bạn qua kênh nào? (Zalo, Facebook, giới thiệu...)"

**Xử lý khi thiếu thông tin:**
- Nếu khách cung cấp ít → AI tự suy luận dựa trên ngành/lĩnh vực, đánh dấu [CẦN XÁC NHẬN] ở những chỗ giả định
- Không chặn tiến trình vì thiếu thông tin
- Ưu tiên tiến về phía trước, hỏi lại cuối cùng

---

### BƯỚC 2 — GIẢI PHẪU CORE OFFER

Từ thông tin thu thập, điền vào template phân tích sau. Đọc `references/hormozi-framework.md` để áp dụng đúng công thức.

```
═══════════════════════════════════════
PHÂN TÍCH CORE OFFER
═══════════════════════════════════════
Tên sản phẩm gốc : [...]
Loại              : [Dịch vụ / Khóa học / Sản phẩm vật lý / Sản phẩm số / Coaching]
Giá hiện tại      : [...]

HÀNH TRÌNH KHÁCH HÀNG
───────────────────────
Điểm A (vấn đề)   : [họ đang ở đâu, đang gặp gì]
Điểm B (kết quả)  : [họ muốn đến đâu, muốn có gì]
Các bước hành trình:
  Bước 1: [...]
  Bước 2: [...]
  Bước 3: [...]
  Bước 4: [...]
  Bước 5: [...]
Bước khó nhất     : [...]
Bước mất thời gian nhất: [...]

GRAND SLAM OFFER (theo Hormozi)
────────────────────────────────
Dream Outcome          : [kết quả họ thực sự mơ ước — cụ thể, đo được]
Perceived Likelihood   : [tại sao họ tin người bán làm được — proof, credibility]
Time to Result         : [bao lâu thấy kết quả đầu tiên]
Effort Required        : [họ phải làm gì — càng ít càng tốt]
Guarantee              : [cam kết cụ thể — xem references/hormozi-framework.md]

3 NHÓM KHÁCH HÀNG
───────────────────
Nhóm 1 (ít tiền, tự làm): [mô tả]
Nhóm 2 (trung bình, cần hỗ trợ): [mô tả]
Nhóm 3 (nhiều tiền, muốn nhanh): [mô tả]
═══════════════════════════════════════
```

---

### BƯỚC 3 — MA TRẬN SINH SẢN PHẨM (3 CHIỀU)

Đây là bước tạo ra hàng chục sản phẩm từ 1 Core Offer. Đọc `references/product-matrix.md` trước khi thực hiện.

Áp dụng đồng thời 3 chiều phân tích — mỗi chiều là 1 cách nhìn khác nhau vào cùng 1 Core Offer:

```
CHIỀU 1 — 7 TẦNG THEO CHỨC NĂNG
──────────────────────────────────────────────────────────────
T1  Lead Magnet / Free        Lấy lead, tạo niềm tin
T2  Entry (Template, PDF)     Đơn đầu, tạo kết quả nhanh
T3  Supporting Tools          Bổ sung nhanh — dễ upsell
T4  Workshop / Triển khai     Kết quả thật — cảm nhận mạnh
T5  Coaching / DFY            Cá nhân hóa — chuyển đổi cao
T6  Membership / Community    Duy trì — phát triển dài lâu
T7  Licensing / Partner       Khách thành cộng sự, nhân bản
──────────────────────────────────────────────────────────────

CHIỀU 2 — 3 CẤP ĐỘ SẢN PHẨM SỐ
──────────────────────────────────────────────────────────────
Entry    Template / Tài liệu / Khóa học nhỏ  → Cụ thể, thao tác nhanh
Core     Workshop / Funnel / Coaching         → Tư duy + công cụ
Premium  Mentoring / Done-for-You / Đội nhóm → Kết quả cuối cùng
──────────────────────────────────────────────────────────────

CHIỀU 3 — 5 GIAI ĐOẠN NHẬN THỨC (AIDA mở rộng)
──────────────────────────────────────────────────────────────
Awareness   Biết vấn đề          Lead Magnet, Ebook, Short video
Interest    Quan tâm giải pháp   Template, Mini course, Checklist
Decision    Ra quyết định        Workshop, Combo, Đề dùng thử
Action      Triển khai thật      Coaching, Dịch vụ, DFY
Retain      Duy trì, mở rộng     Membership, Partner, Licensing
──────────────────────────────────────────────────────────────
```

**Thực hiện 3 bước nhỏ trong Bước 3:**

**3A — Liệt kê thô toàn bộ sản phẩm tiềm năng**

Với mỗi tầng (T1→T7), đặt câu hỏi:
- Cấp Entry của tầng này là gì? (ai tự làm được ngay)
- Cấp Core của tầng này là gì? (cần hướng dẫn + hệ thống)
- Cấp Premium của tầng này là gì? (được làm cùng / làm thay)

Ghi ra toàn bộ — chưa lọc, chưa đặt tên — mục tiêu là có nhiều nhất có thể.

**3B — Ánh xạ vào Ma trận tổng**

Điền vào bảng sau (mỗi ô = 1 sản phẩm cụ thể, bỏ trống nếu không phù hợp):

```
             AWARENESS      INTEREST       DECISION       ACTION         RETAIN
T1 Free      [tên SP]       [tên SP]
T2 Entry                    [tên SP]       [tên SP]
T3 Tools                    [tên SP]       [tên SP]
T4 Workshop                               [tên SP]       [tên SP]
T5 Coach/DFY                                             [tên SP]       [tên SP]
T6 Community                                                            [tên SP]       [tên SP]
T7 Partner                                                              [tên SP]
```

> Lý thuyết tối đa: 7 tầng × 5 giai đoạn = 35 ô → thực tế thường điền được 12–20 sản phẩm.

**3C — Lọc và phân nhóm ưu tiên**

Sau khi có danh sách thô, phân thành 3 nhóm:

```
NHÓM A — XÂY NGAY (tuần 1–4)
→ Tiêu chí: Tạo trong 1–3 ngày + Liên quan trực tiếp Core Offer
→ Thường là: Lead Magnet T1, Entry T2, Downsell T4

NHÓM B — XÂY SAU KHI CÓ DOANH THU (tháng 2–3)
→ Tiêu chí: Cần thêm thời gian hoặc cần proof trước
→ Thường là: Workshop T4, Supporting Tools T3, Coaching T5

NHÓM C — XÂY KHI CÓ CỘNG ĐỒNG (tháng 4+)
→ Tiêu chí: Cần nhiều người hoặc infrastructure
→ Thường là: Membership T6, Community T6, Partner T7
```

Đọc thêm ví dụ điền ma trận theo từng ngành tại: `references/product-matrix.md`

---

### BƯỚC 4 — THIẾT KẾ 5 TẦNG ĐẦY ĐỦ

Đọc `references/product-tiers.md` và `references/pricing-vietnam.md` trước khi thiết kế.

Mỗi tầng output đủ 5 mục: **(1) Tên → (2) Mô tả → (3) Giá → (4) Cách tạo → (5) Móc chuyển đổi lên tầng tiếp)**

#### TẦNG 1 — Thu hút (Lead Generation)
- Mục tiêu: kéo người lạ thành lead, KHÔNG bán hàng
- Giá: miễn phí hoặc 0–197k
- Tạo tối thiểu 3 sản phẩm:
  - **Lead Magnet miễn phí**: trao đổi lấy email/số điện thoại
  - **Tripwire (Low-ticket)**: 49k–197k, tạo trải nghiệm đầu tiên, dễ quyết định
  - **Free Content**: loại nội dung đăng mạng xã hội thu traffic tự nhiên

#### TẦNG 2 — Core Offer ⭐
- Mục tiêu: sản phẩm chính tạo doanh thu, là trung tâm hệ sinh thái
- Giá: tham chiếu `references/pricing-vietnam.md` theo ngành
- Phải có: Grand Slam Offer + Value Stack + Guarantee + Onboarding rõ ràng
- Số hóa: SOP quy trình, tài liệu bàn giao, video hướng dẫn, checklist kết quả

#### TẦNG 3 — Upsell (High Ticket)
- Mục tiêu: phục vụ khách đã mua Core muốn kết quả nhanh hơn / toàn diện hơn
- Giá: gấp 3–10 lần Core Offer
- Tạo tối thiểu 2 dạng:
  - **Coaching / Mentoring 1:1**: cầm tay chỉ việc, cam kết kết quả
  - **Done-for-You**: làm thay toàn bộ, khách chỉ nhận kết quả

#### TẦNG 4 — Downsell (Self-Paced)
- Mục tiêu: giữ lại khách chưa đủ ngân sách mua Core Offer
- Giá: bằng 20–50% Core Offer
- Tạo tối thiểu 2 dạng:
  - **Phiên bản tự học**: nội dung Core nhưng không có hỗ trợ trực tiếp
  - **Order Bump / Gói nhỏ**: 1 phần cụ thể của Core, giải quyết 1 vấn đề nhỏ

#### TẦNG 5 — Retention & Community
- Mục tiêu: tăng LTV, upsell ngược, tạo cộng đồng, giảm churn
- Giá: phí hàng tháng (tham chiếu `references/pricing-vietnam.md`)
- Gồm:
  - Membership: nội dung mới liên tục + Q&A định kỳ
  - Community: nhóm có kiểm soát (Telegram / Zalo / Skool)
  - Email Sequence: 3 email tự động (chào mừng → nurture → chốt)
  - 5 Horsemen of Retention: xem `references/product-tiers.md`

---

### BƯỚC 5 — THIẾT KẾ MÓC CHUYỂN ĐỔI

Mỗi tầng phải có câu móc rõ ràng để kéo khách sang tầng tiếp theo. Không có móc = phễu bị rò rỉ.

```
TEMPLATE MÓC CHUYỂN ĐỔI:
──────────────────────────────────────────────────────────
Từ T1 → T2: "Bạn muốn có người đồng hành thay vì tự làm? → [tên Core Offer]"
Từ T2 → T3: "Muốn kết quả nhanh gấp đôi, mình làm cùng 1:1? → [tên Upsell]"
Từ T2 → T4: "Chưa đủ ngân sách? Bắt đầu với phiên bản này → [tên Downsell]"
Từ T4 → T2: "Thấy khó tự làm? Nâng lên kèm trực tiếp → [tên Core Offer]"
Từ T2 → T5: "Muốn tiếp tục sau khi đạt kết quả? → [tên Community/Membership]"
Từ T5 → T3: "Muốn đi nhanh hơn nữa? → [tên Upsell]"
──────────────────────────────────────────────────────────
```

---

### BƯỚC 6 — OUTPUT HOÀN CHỈNH

Xuất ra bản tổng hợp theo format chuẩn sau:

```
════════════════════════════════════════════════════
HỆ SINH THÁI SẢN PHẨM SỐ
[Tên thương hiệu / Tên người dùng]
════════════════════════════════════════════════════

TẦNG 1 — THU HÚT
──────────────────
🎁 [Tên Lead Magnet] — Miễn phí
   Mô tả  : [1 dòng]
   Format : [PDF / Video / Template / Checklist]
   Tạo bằng: [công cụ] | Thời gian: [ước tính]
   Móc    : "[câu dẫn vào Core Offer]"

💰 [Tên Tripwire] — [Giá]k
   Mô tả  : [1 dòng]
   Format : [loại sản phẩm số]
   Tạo bằng: [công cụ] | Thời gian: [ước tính]
   Móc    : "[câu dẫn vào Core Offer]"

📢 Content Strategy
   Chủ đề 1: [tên chủ đề] → [kênh đăng]
   Chủ đề 2: [tên chủ đề] → [kênh đăng]
   Chủ đề 3: [tên chủ đề] → [kênh đăng]

────────────────────────────────────────────────────
TẦNG 2 — CORE OFFER ⭐
────────────────────────
🏆 [Tên Core Offer] — [Giá]
   Mô tả  : [2-3 dòng]
   Gồm    : [liệt kê Value Stack từng item + giá trị cảm nhận]
             · [Item 1] ................. (trị giá [X]k)
             · [Item 2] ................. (trị giá [X]k)
             · [Item 3] ................. (trị giá [X]k)
             Tổng giá trị: [X]k — Bạn chỉ trả: [Giá]k
   Guarantee: [cam kết cụ thể]
   Số hóa : [công cụ + cách giao nhận]
   Móc T3 : "[câu dẫn lên Upsell]"
   Móc T4 : "[câu dẫn xuống Downsell]"

────────────────────────────────────────────────────
TẦNG 3 — UPSELL
─────────────────
🚀 [Tên Coaching/DFY] — [Giá]
   Mô tả  : [1 dòng]
   Dành cho: [mô tả đúng đối tượng]
   Gồm    : [liệt kê nhanh]
   Móc T5 : "[câu dẫn vào Community]"

────────────────────────────────────────────────────
TẦNG 4 — DOWNSELL
───────────────────
📦 [Tên Self-paced / Mini] — [Giá]
   Mô tả  : [1 dòng]
   Dành cho: [mô tả đúng đối tượng]
   Format : [video / PDF / Google Form]
   Tạo bằng: [công cụ] | Thời gian: [ước tính]
   Móc T2 : "[câu kéo lên Core Offer khi họ cần thêm]"

────────────────────────────────────────────────────
TẦNG 5 — RETENTION & COMMUNITY
─────────────────────────────────
♾️ [Tên Membership / Community] — [Giá]/tháng
   Gồm    : [liệt kê quyền lợi]
   Nền tảng: [Telegram / Zalo / Skool]
   Email Sequence:
     · Email 1 (ngay lập tức): [nội dung chính]
     · Email 2 (ngày 2):       [nội dung chính]
     · Email 3 (ngày 4):       [nội dung chính + CTA mua Core]
   5 Horsemen: [xem references/product-tiers.md áp dụng cụ thể]

════════════════════════════════════════════════════
GRAND SLAM COMBO ĐỀ XUẤT
════════════════════════════════════════════════════
🎁 "[Tên Combo]" — [Giá combo]
   Giá trị cảm nhận: [tổng X]k
   Gồm: [liệt kê sản phẩm gộp]
   Cam kết: [guarantee combo]

════════════════════════════════════════════════════
LỘ TRÌNH XÂY DỰNG ĐỀ XUẤT
════════════════════════════════════════════════════
Tuần 1–2 : Xây Core Offer → bán đơn đầu tiên → lấy feedback
Tuần 3–4 : Tạo Lead Magnet Tầng 1 → thu lead nhiều hơn
Tháng 2  : Tạo Downsell từ tài liệu Core đã có → tái sử dụng
Tháng 3  : Tạo Upsell khi đã có 10+ khách thành công + case study
Tháng 4+ : Mở Community/Retention khi có 20+ người trong hệ sinh thái
════════════════════════════════════════════════════
```

---

### LƯU OUTPUT RA FILE

Ngay sau khi hoàn thành BƯỚC 6, lưu toàn bộ nội dung output vào file **`he-sinh-thai-so.md`** trong thư mục làm việc hiện tại.

File phải chứa đầy đủ:
- Phân tích Core Offer (BƯỚC 2)
- Ma trận 3 chiều + danh sách sản phẩm phân nhóm (BƯỚC 3)
- Thiết kế 7 tầng đầy đủ với Value Stack, Guarantee, Móc chuyển đổi (BƯỚC 4–5)
- Grand Slam Combo đề xuất
- Lộ trình xây dựng theo thứ tự ưu tiên

---

### SAU KHI OUTPUT XONG — HỎI KHÁCH HÀNG

> "Bạn muốn tôi đi sâu vào phần nào tiếp theo?"
> - **A)** Viết sales script chốt đơn cho Core Offer (Zalo / Messenger)
> - **B)** Viết chuỗi 3 email tự động hoàn chỉnh
> - **C)** Lên kế hoạch content 7 ngày để thu lead Tầng 1
> - **D)** Viết landing page copy cho Core Offer
> - **E)** Thiết kế Grand Slam Offer chi tiết hơn với Value Stack đầy đủ

---

## LƯU Ý BẮT BUỘC

| # | Quy tắc |
|---|---------|
| 1 | Không bịa số liệu — nếu không biết giá ngành, ghi [CẦN XÁC NHẬN] |
| 2 | Ưu tiên sản phẩm số dễ tạo: PDF, video Loom, Notion, Google Sheet, Google Form |
| 3 | Giá phải phù hợp thị trường VN — tham chiếu `references/pricing-vietnam.md` |
| 4 | Mỗi tầng phải có móc chuyển đổi rõ ràng — không có móc = phễu rò rỉ |
| 5 | Mỗi sản phẩm phải kèm "cách tạo" cụ thể (công cụ + thời gian ước tính) |
| 6 | Xây đúng thứ tự: Core → T1 → T4 → T3 → T5. Không xây ngược |
| 7 | Số hóa = tạo ra được trong vòng 1–7 ngày, không phải dự án dài hạn |
| 8 | Sau khi output xong — lưu toàn bộ vào file `he-sinh-thai-so.md` trong thư mục làm việc |
