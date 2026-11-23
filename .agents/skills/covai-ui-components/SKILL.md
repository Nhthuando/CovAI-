---
name: covai-ui-components
description: Hướng dẫn và cung cấp mẫu code xây dựng các component giao diện người dùng chuẩn phong cách kỹ thuật (shadcn/ui, Linear, GitHub Primer) cho CovAI với React 19 và Tailwind CSS v4. Kích hoạt khi người dùng yêu cầu tạo mới, sửa đổi hoặc làm đẹp UI, Modal, Button, Card, Table, hay Form.
---

# CovAI UI Component Patterns & Best Practices

Khi xây dựng hoặc refactor các thành phần giao diện trong `client/src/`, AI Agent cần tuân thủ các khuôn mẫu component (Component Templates) dưới đây:

---

## 1. Nút Bấm (Button Component)

Mọi nút bấm phải có các biến thể rõ ràng, trạng thái loading và kích thước đồng nhất:

```jsx
import React from 'react';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] border-transparent',
  secondary: 'bg-[var(--color-surface-secondary)] text-[var(--color-text)] hover:bg-[var(--color-border)] border-[var(--color-border)]',
  outline: 'bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border-[var(--color-border)]',
  ghost: 'bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border-transparent',
  danger: 'bg-[var(--color-danger)] text-white hover:opacity-90 border-transparent',
};

const SIZES = {
  sm: 'px-2.5 py-1 text-xs gap-1.5',
  md: 'px-3.5 py-1.5 text-sm gap-2',
  lg: 'px-4.5 py-2 text-base gap-2.5',
};

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  className = '',
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded-md border transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon && <Icon className="w-4 h-4 shrink-0" />}
      {children}
    </button>
  );
}
```

---

## 2. Thẻ Thống Kê Chỉ Số (Metric / Coverage Card)

Dùng để hiển thị phần trăm độ bao phủ (Coverage), số lượng test case, API pass/fail:

```jsx
import React from 'react';

export function MetricCard({ title, value, subtext, icon: Icon, trend, status = 'neutral' }) {
  const statusColors = {
    pass: 'text-[var(--color-success)]',
    warn: 'text-[var(--color-warning)]',
    fail: 'text-[var(--color-danger)]',
    neutral: 'text-[var(--color-text)]',
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
        <span>{title}</span>
        {Icon && <Icon className="w-4 h-4 text-[var(--color-text-muted)]" />}
      </div>
      <div className="my-2">
        <span className={`text-2xl font-bold font-mono tracking-tight tabular-nums ${statusColors[status]}`}>
          {value}
        </span>
      </div>
      {subtext && (
        <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
          {subtext}
        </div>
      )}
    </div>
  );
}
```

---

## 3. Nhãn Trạng Thái (Status Badge)

Hiển thị trạng thái kiểm thử (`PASSED`, `FAILED`, `PENDING`, `UNCOVERED`):

```jsx
import React from 'react';

const BADGE_STYLES = {
  pass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  fail: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  warn: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  neutral: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  primary: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
};

export function StatusBadge({ status = 'neutral', label, dot = true }) {
  const dotColors = {
    pass: 'bg-emerald-400',
    fail: 'bg-rose-400',
    warn: 'bg-amber-400',
    neutral: 'bg-slate-400',
    primary: 'bg-indigo-400',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium border ${BADGE_STYLES[status]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[status]}`} />}
      {label}
    </span>
  );
}
```

---

## 4. Bảng Dữ Liệu Kỹ Thuật (Developer Data Table)

- Header cố định, chữ nhỏ, font đậm nhẹ (`uppercase text-xs tracking-wider`).
- Các hàng có border phân cách 1px, hiệu ứng hover nhẹ: `hover:bg-[var(--color-surface-secondary)]`.
- Cột số liệu, file path, test ID căn lề chuẩn và áp dụng font monospace.

---

## 5. Hộp Thoại / Modal Xác Nhận (Dialog / Confirm Modal)

- Backdrop: `bg-black/60 backdrop-blur-xs`.
- Khung Modal: Tối đa `max-w-md` hoặc `max-w-lg`, bo góc `rounded-lg`, nền `--color-surface`, viền `--color-border`.
- Header có tiêu đề rõ ràng và nút đóng 'X'.
- Footer chứa 2 nút: Hủy bỏ (`variant="secondary"`) và Hành động chính (`variant="primary"` hoặc `variant="danger"`).
