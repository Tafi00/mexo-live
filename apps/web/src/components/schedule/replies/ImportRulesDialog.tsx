import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, FileUp, Upload } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';

const TEMPLATE_HEADERS = ['Chủ đề', 'Từ khóa (ngăn cách bằng dấu phẩy)', 'Câu hỏi mẫu', 'Câu trả lời'];
const TEMPLATE_ROWS = [
  ['Bảo hành', 'bảo hành, bh, đổi trả, lỗi', 'Sản phẩm bảo hành bao lâu vậy shop?', 'Dạ sản phẩm được bảo hành 12 tháng, lỗi do nhà sản xuất shop đổi mới trong 7 ngày ạ.'],
  ['Size', 'size, kích thước, form, mặc vừa', 'Mình cao 1m60 nặng 50kg mặc size nào?', 'Dạ bạn xem bảng size trong ảnh sản phẩm, còn phân vân cứ để lại chiều cao cân nặng ngay dưới bình luận để shop tư vấn ạ.'],
  ['Giao hàng', 'giao hàng, ship, bao lâu nhận, vận chuyển', 'Bao lâu thì nhận được hàng?', 'Dạ shop đóng gói trong ngày, thời gian giao tùy khu vực, thường từ hai đến bốn ngày ạ.'],
];

function csvCell(v: string): string {
  return /[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Tạo file CSV mẫu (UTF-8 có BOM để Excel đọc đúng tiếng Việt) */
export function downloadRuleTemplate() {
  const csv = '﻿' + [TEMPLATE_HEADERS, ...TEMPLATE_ROWS].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mau-kich-ban-tra-loi.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

export function ImportRulesDialog({ open, onClose, shopId }: { open: boolean; onClose: () => void; shopId: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
      setError(null);
    }
  }, [open]);

  const upload = useAction(
    (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api.post<ImportResult>(`/api/shops/${shopId}/reply-rules/import`, fd);
    },
    {
      silentError: true,
      invalidate: [['shop', shopId, 'reply-rules'], ['shop', shopId, 'replies']],
      success: (r) => (r.created + r.updated ? `Đã nhập ${r.created + r.updated} kịch bản` : null),
      onSuccess: (r) => setResult(r),
      onError: (e) => setError(errorMessage(e)),
    },
  );

  function pick(f: File) {
    setError(null);
    setResult(null);
    if (!/\.(xlsx|csv)$/i.test(f.name)) {
      setError('Chỉ nhận file .xlsx hoặc .csv');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('File tối đa 5 MB');
      return;
    }
    setFile(f);
    upload.mutate(f);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Nhập kịch bản từ file"
      description="Dùng file Excel (.xlsx) hoặc CSV. Dòng đầu là tiêu đề cột."
      footer={
        <>
          <Button variant="ghost" icon={<FileSpreadsheet className="size-4" />} onClick={downloadRuleTemplate} className="mr-auto">
            Tải file mẫu
          </Button>
          <Button variant={result ? 'primary' : 'ghost'} onClick={onClose}>
            {result ? 'Xong' : 'Đóng'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-4 bg-surface-2/70 text-2xs font-semibold uppercase tracking-wide text-muted">
            {['A · Chủ đề', 'B · Từ khóa', 'C · Câu hỏi mẫu', 'D · Câu trả lời'].map((h) => (
              <div key={h} className="border-r border-line px-2.5 py-1.5 last:border-r-0">
                {h}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 text-xs">
            {TEMPLATE_ROWS[0].map((c, i) => (
              <div key={i} className="truncate border-r border-t border-line px-2.5 py-1.5 last:border-r-0" title={c}>
                {c}
              </div>
            ))}
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Từ khóa ngăn cách bằng dấu phẩy, tối đa 20 từ khóa mỗi dòng.</li>
          <li>
            <b className="text-fg">Trùng chủ đề</b> với kịch bản đã có thì cập nhật kịch bản đó; chủ đề mới thì thêm mới.
          </li>
          <li>Câu trả lời tối đa 300 ký tự và phải qua lớp lọc nội dung; dòng vi phạm sẽ bị bỏ qua.</li>
        </ul>

        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) pick(f);
          }}
          disabled={upload.isPending}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-2/40 px-4 py-6 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-60 dark:hover:bg-brand-950/20"
        >
          {upload.isPending ? <Upload className="size-6 animate-bounce text-brand-500" /> : <FileUp className="size-6 text-muted" />}
          <span className="text-sm font-medium">{upload.isPending ? `Đang nhập ${file?.name ?? ''}…` : file ? `Chọn file khác (đã chọn ${file.name})` : 'Chọn hoặc kéo thả file .xlsx / .csv'}</span>
          <span className="text-xs text-muted">Tối đa 5 MB</span>
        </button>
        <input
          ref={ref}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
            e.target.value = '';
          }}
        />

        {error && (
          <Callout tone="danger" title="Không nhập được file">
            {error}
          </Callout>
        )}
        {result && (
          <div className="space-y-3">
            <Callout tone={result.errors.length ? 'warning' : 'success'} icon={<CheckCircle2 className="size-4" />} title={`Thêm mới ${result.created} · cập nhật ${result.updated} kịch bản`}>
              {result.errors.length ? `${result.errors.length} dòng lỗi bị bỏ qua — sửa trong file rồi nhập lại (dòng đúng sẽ chỉ được cập nhật).` : 'Tất cả các dòng đều hợp lệ.'}
            </Callout>
            {result.errors.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-line">
                <Table minWidth={360}>
                  <THead>
                    <tr>
                      <Th className="w-20">Dòng</Th>
                      <Th>Lỗi</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <Tr key={i}>
                        <Td className="tabular">{e.row}</Td>
                        <Td className="text-rose-600 dark:text-rose-400">{e.message}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
