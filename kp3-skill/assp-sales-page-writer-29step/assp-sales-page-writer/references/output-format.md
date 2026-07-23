# Output Format — Sales Page 8000+ Từ

---

## Cấu trúc file output

Tên file: `sales-page-[tên-sản-phẩm]-v1.md`

```
═══════════════════════════════════════════════════
SALES PAGE — [TÊN SẢN PHẨM]
Viết theo cấu trúc Direct Response 29 bước
Dành cho: [Tệp khách hàng từ avatar.md]
Cấp độ nhận thức target: [1–5]
═══════════════════════════════════════════════════

--- GIAI ĐOẠN 1: THU HÚT ---

[Bước 1: Kêu gọi tên khách hàng]
[Nội dung...]

[Bước 2: Headline]
[Nội dung...]

[Bước 3: Sub-headline]
[Nội dung...]

[Bước 4: Preview Offer]
[Nội dung...]

[Bước 5: CTA #1]
[Nội dung...]

[Bước 6: Gary Halbert Opening]
[Nội dung...]

--- GIAI ĐOẠN 2: KHƠI GỢI ---

[Bước 7–10...]

--- GIAI ĐOẠN 3: GIẢI PHÁP ---

[Bước 11–17...]

--- GIAI ĐOẠN 4: TIN TƯỞNG ---

[Bước 18–20...]

--- GIAI ĐOẠN 5: CHỐT ĐƠN ---

[Bước 21–29...]

═══════════════════════════════════════════════════
PLACEHOLDER CHƯA CÓ DATA:
[ ] Testimonial #1 — cần: tên + ảnh + kết quả cụ thể
[ ] Số liệu tại bước X — cần xác nhận
[ ] Giá bán — chờ xác nhận
═══════════════════════════════════════════════════
```

---

## HTML Visual Output

Sau khi viết xong full bài → tạo HTML preview đẹp:

```html
<div style="
  max-width: 800px;
  margin: 0 auto;
  padding: 40px 24px;
  background: var(--color-background-primary, #ffffff);
  font-family: 'Inter', sans-serif;
  line-height: 1.7;
">

  <!-- Header -->
  <div style="
    border-left: 4px solid #1D9E75;
    padding-left: 16px;
    margin-bottom: 32px;
  ">
    <p style="font-size: 12px; color: #64748b; margin: 0 0 4px;">
      SALES PAGE · DIRECT RESPONSE 29 BƯỚC
    </p>
    <h1 style="font-size: 24px; font-weight: 700; margin: 0;">
      [TÊN SẢN PHẨM]
    </h1>
    <p style="font-size: 14px; color: #64748b; margin: 8px 0 0;">
      Tệp: [avatar name] · Cấp độ nhận thức: [X]
    </p>
  </div>

  <!-- Phase badges -->
  <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 32px;">
    <span style="background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;">
      Giai đoạn 1: Thu hút (Nhóm D)
    </span>
    <span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;">
      Giai đoạn 2: Khơi gợi (Nhóm I)
    </span>
    <span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;">
      Giai đoạn 3–4: Giải pháp + Tin tưởng (Nhóm S)
    </span>
    <span style="background: #ede9fe; color: #4c1d95; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;">
      Giai đoạn 5: Chốt đơn (Nhóm C)
    </span>
  </div>

  <!-- Content sections — render từng bước -->
  [Nội dung bài viết theo từng bước]

  <!-- Placeholder warnings -->
  <div style="
    border-left: 4px solid #EF9F27;
    background: #fffbeb;
    padding: 16px;
    margin-top: 32px;
    border-radius: 0 8px 8px 0;
  ">
    <p style="font-weight: 600; margin: 0 0 8px; color: #92400e;">
      ⚠️ Cần bổ sung trước khi publish:
    </p>
    <ul style="margin: 0; padding-left: 20px; color: #78350f; font-size: 14px;">
      [Danh sách placeholder]
    </ul>
  </div>

  <!-- Copy button -->
  <div style="margin-top: 24px; display: flex; gap: 12px;">
    <button onclick="navigator.clipboard.writeText(document.querySelector('#sales-copy').innerText)"
      style="
        background: #1D9E75; color: white;
        border: none; padding: 10px 20px;
        border-radius: 8px; cursor: pointer;
        font-weight: 600; font-size: 14px;
      ">
      📋 Copy toàn bộ bài
    </button>
    <button onclick="downloadMD()"
      style="
        background: transparent; color: #1D9E75;
        border: 2px solid #1D9E75; padding: 10px 20px;
        border-radius: 8px; cursor: pointer;
        font-weight: 600; font-size: 14px;
      ">
      ⬇️ Tải file .md
    </button>
  </div>
</div>
```

---

## Quy tắc màu sắc

| Trạng thái | Border màu |
|-----------|-----------|
| Đoạn mạnh — insight quan trọng | `#1D9E75` (xanh lá) |
| Cần chú ý — placeholder / cần bổ sung | `#EF9F27` (cam) |
| Chưa có data — để trống | `#E24B4A` (đỏ) |

---

## Placeholder format

Mỗi khi thiếu data, dùng:
```
[PLACEHOLDER — CẦN: mô tả rõ cần gì]
```

Ví dụ:
- `[PLACEHOLDER — CẦN: testimonial có ảnh thật + kết quả đo được]`
- `[PLACEHOLDER — CẦN: xác nhận giá bán chính thức]`
- `[PLACEHOLDER — CẦN: số liệu khách hàng đã dùng]`

Không bao giờ bịa số liệu hoặc testimonial.

---

## Sau khi hoàn thành

Hỏi:
> "Sales page đã viết xong. Bạn muốn:
> A) Review và chỉnh sửa từng phần?
> B) Tối ưu headline — thử 3 phiên bản khác?
> C) Viết ads cho traffic page này (→ dùng assp-ad-copy-machine)?
> D) Viết email follow-up (→ dùng assp-email-closer)?"
