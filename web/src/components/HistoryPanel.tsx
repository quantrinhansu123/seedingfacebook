'use client';

import { useMemo, useState } from 'react';
import { CircleCheckBig, Download, RefreshCw, X } from 'lucide-react';
import type { CommentLog } from '@/lib/types';
import type { SheetData } from 'write-excel-file/browser';

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function vietnamDateKey(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = dateKeyFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? `${year}-${month}-${day}` : '';
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormatter.format(date);
}

function statusLabel(status?: string) {
  if (status === 'failed') return 'Lỗi';
  if (status === 'processed') return 'Đã xử lý';
  if (status === 'success') return 'Đã comment';
  return status || '—';
}

function uniqueSheetName(value: string, usedNames: Set<string>, fallback: string) {
  const normalized = value
    .trim()
    .replace(/[\\/*?:[\]]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 31) || fallback;
  let name = normalized;
  let suffix = 2;
  while (usedNames.has(name.toLocaleLowerCase('vi'))) {
    const suffixText = ` (${suffix})`;
    name = `${normalized.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedNames.add(name.toLocaleLowerCase('vi'));
  return name;
}

export function HistoryPanel({
  rows,
  status,
  onReload,
  isAdmin = false,
}: {
  rows: CommentLog[];
  status: string;
  onReload: () => Promise<void>;
  isAdmin?: boolean;
}) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const invalidRange = Boolean(fromDate && toDate && fromDate > toDate);
  const filteredRows = useMemo(() => {
    if (invalidRange) return [];
    return rows.filter((item) => {
      if (!fromDate && !toDate) return true;
      const dateKey = vietnamDateKey(item.created_at);
      if (!dateKey) return false;
      if (fromDate && dateKey < fromDate) return false;
      if (toDate && dateKey > toDate) return false;
      return true;
    });
  }, [fromDate, invalidRange, rows, toDate]);
  const successfulCount = useMemo(
    () => filteredRows.filter((item) => item.status === 'success').length,
    [filteredRows],
  );

  async function exportExcel() {
    if (invalidRange || !filteredRows.length || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      const header = (value: string) => ({
        value,
        type: String,
        fontWeight: 'bold' as const,
        textColor: '#FFFFFF',
        backgroundColor: '#1D4ED8',
        align: 'center' as const,
        alignVertical: 'center' as const,
        height: 28,
        borderColor: '#B8C5D9',
        borderStyle: 'thin' as const,
      });
      const textCell = (value: unknown, wrap = false) => ({
        value: String(value ?? ''),
        type: String,
        format: '@',
        wrap,
        alignVertical: 'top' as const,
        borderColor: '#D9E1EC',
        borderStyle: 'thin' as const,
      });
      const numberCell = (value: number, backgroundColor = '') => ({
        value,
        type: Number,
        align: 'center' as const,
        alignVertical: 'center' as const,
        backgroundColor: backgroundColor || undefined,
        borderColor: '#D9E1EC',
        borderStyle: 'thin' as const,
      });
      const percentageCell = (value: number) => ({
        value,
        type: Number,
        format: '0.0%',
        align: 'center' as const,
        alignVertical: 'center' as const,
        borderColor: '#D9E1EC',
        borderStyle: 'thin' as const,
      });
      const headerRow = () => [
        header('STT'),
        header('Thời gian'),
        header('Nhân sự'),
        header('Tài khoản'),
        header('Bài viết'),
        header('Link bài viết'),
        header('Nội dung'),
        header('Trạng thái'),
        header('Chi tiết lỗi'),
      ];
      const commentRows = (items: CommentLog[]): SheetData => [
        headerRow(),
        ...items.map((item, index) => [
          {
            value: index + 1,
            type: Number,
            align: 'center' as const,
            alignVertical: 'top' as const,
            borderColor: '#D9E1EC',
            borderStyle: 'thin' as const,
          },
          textCell(formatDateTime(item.created_at)),
          textCell(item.staff_name || item.staff_username || 'Ẩn danh'),
          textCell(item.staff_username ? `@${item.staff_username}` : item.staff_id || ''),
          textCell(item.post_id || ''),
          textCell(item.post_url || ''),
          textCell(item.comment_text || '', true),
          {
            ...textCell(statusLabel(item.status)),
            textColor: item.status === 'failed' ? '#B91C1C' : '#047857',
            backgroundColor: item.status === 'failed' ? '#FEE2E2' : '#DCFCE7',
          },
          textCell(item.error_message || '', true),
        ]),
        [null, null, null, null, null, null, null, null, null],
        [
          {
            value: 'TỔNG COMMENT THÀNH CÔNG',
            type: String,
            columnSpan: 7,
            fontWeight: 'bold' as const,
            textColor: '#166534',
            backgroundColor: '#DCFCE7',
            align: 'right' as const,
            alignVertical: 'center' as const,
            borderColor: '#86EFAC',
            borderStyle: 'thin' as const,
          },
          null,
          null,
          null,
          null,
          null,
          null,
          {
            value: items.filter((item) => item.status === 'success').length,
            type: Number,
            columnSpan: 2,
            fontWeight: 'bold' as const,
            textColor: '#166534',
            backgroundColor: '#DCFCE7',
            align: 'center' as const,
            alignVertical: 'center' as const,
            borderColor: '#86EFAC',
            borderStyle: 'thin' as const,
          },
          null,
        ],
      ];
      const sheetColumns = [
        { width: 7 },
        { width: 21 },
        { width: 24 },
        { width: 20 },
        { width: 38 },
        { width: 42 },
        { width: 55 },
        { width: 16 },
        { width: 36 },
      ];
      const makeCommentSheet = (sheet: string, items: CommentLog[]) => ({
        sheet,
        data: commentRows(items),
        columns: sheetColumns,
        stickyRowsCount: 1,
        orientation: 'landscape' as const,
        showGridLines: false,
      });
      const staffGroups = new Map<string, CommentLog[]>();
      filteredRows.forEach((item) => {
        const key = item.staff_id || item.staff_username || item.staff_name || 'unknown';
        const group = staffGroups.get(key) || [];
        group.push(item);
        staffGroups.set(key, group);
      });
      const staffGroupList = [...staffGroups.values()].sort((left, right) => {
        const leftLabel = left[0]?.staff_name || left[0]?.staff_username || left[0]?.staff_id || '';
        const rightLabel = right[0]?.staff_name || right[0]?.staff_username || right[0]?.staff_id || '';
        return leftLabel.localeCompare(rightLabel, 'vi');
      });
      const summaryRows: SheetData = [
        [
          header('Nhân sự'),
          header('Tài khoản'),
          header('Tổng comment'),
          header('Thành công'),
          header('Lỗi'),
          header('Tỷ lệ thành công'),
        ],
        ...staffGroupList.map((items) => {
          const first = items[0];
          const successCount = items.filter((item) => item.status === 'success').length;
          const failedCount = items.filter((item) => item.status === 'failed').length;
          return [
            textCell(first?.staff_name || first?.staff_username || first?.staff_id || 'Ẩn danh'),
            textCell(first?.staff_username ? `@${first.staff_username}` : first?.staff_id || ''),
            numberCell(items.length),
            numberCell(successCount),
            numberCell(failedCount),
            percentageCell(items.length ? successCount / items.length : 0),
          ];
        }),
        [null, null, null, null, null, null],
        [
          {
            value: 'TỔNG',
            type: String,
            fontWeight: 'bold' as const,
            backgroundColor: '#DBEAFE',
            borderColor: '#93C5FD',
            borderStyle: 'thin' as const,
          },
          textCell(''),
          numberCell(filteredRows.length, '#DBEAFE'),
          numberCell(successfulCount, '#DCFCE7'),
          numberCell(filteredRows.filter((item) => item.status === 'failed').length, '#FEE2E2'),
          percentageCell(filteredRows.length ? successfulCount / filteredRows.length : 0),
        ],
      ];
      const rangeName = `${fromDate || 'tat-ca'}_${toDate || 'tat-ca'}`;
      const usedSheetNames = new Set(['tổng quan', 'tất cả comment']);
      const sheets = isAdmin
        ? [
            {
              sheet: 'Tổng quan',
              data: summaryRows,
              columns: [{ width: 28 }, { width: 20 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 20 }],
              stickyRowsCount: 1,
              orientation: 'landscape' as const,
              showGridLines: false,
            },
            makeCommentSheet('Tất cả comment', filteredRows),
            ...staffGroupList.map((items, index) => {
              const first = items[0];
              const label = first?.staff_name || first?.staff_username || first?.staff_id || `Nhân sự ${index + 1}`;
              return makeCommentSheet(uniqueSheetName(label, usedSheetNames, `Nhân sự ${index + 1}`), items);
            }),
          ]
        : [makeCommentSheet('Lich su comment', filteredRows)];
      await writeXlsxFile(sheets, {
        fontFamily: 'Arial',
        fontSize: 11,
      }).toFile(`lich-su-comment-sale_${rangeName}.xlsx`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Không xuất được file Excel');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="module-panel">
      <div className="module-head history-head">
        <div>
          <div className="module-kicker">Lịch sử thao tác</div>
          <h2>Comment sale</h2>
        </div>
        <div className="history-actions">
          <label className="history-date-field">
            <span>Từ ngày</span>
            <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="history-date-field">
            <span>Đến ngày</span>
            <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} />
          </label>
          {fromDate || toDate ? (
            <button
              type="button"
              className="table-icon-button history-clear-button"
              title="Xóa bộ lọc ngày"
              onClick={() => {
                setFromDate('');
                setToDate('');
                setExportError('');
              }}
            >
              <X size={17} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="history-export-button"
            disabled={invalidRange || !filteredRows.length || exporting}
            onClick={() => void exportExcel()}
          >
            <Download size={17} aria-hidden="true" />
            <span>{exporting ? 'Đang xuất...' : 'Xuất Excel'}</span>
          </button>
          <button type="button" className="table-icon-button" title="Tải lại" onClick={() => void onReload()}>
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={`history-filter-meta${invalidRange ? ' error' : ''}`}>
        {invalidRange
          ? 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.'
          : `Hiển thị ${filteredRows.length}/${rows.length} bản ghi${fromDate || toDate ? ' trong khoảng đã chọn' : ''}.`}
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Nhân sự</th>
              <th>Bài viết</th>
              <th>Nội dung</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length ? (
              filteredRows.map((item, idx) => (
                <tr key={`${item.id || idx}-${item.created_at || ''}`}>
                  <td>{formatDateTime(item.created_at)}</td>
                  <td>
                    <b>{item.staff_name || item.staff_username || 'Ẩn danh'}</b>
                    <small>{item.staff_username ? `@${item.staff_username}` : item.staff_id || ''}</small>
                  </td>
                  <td className="mono-cell">{item.post_id || '-'}</td>
                  <td>{item.comment_text || item.error_message || '-'}</td>
                  <td>
                    <span
                      className={
                        item.status === 'failed'
                          ? 'status-pill fail'
                          : 'status-pill ok'
                      }
                    >
                      {statusLabel(item.status)}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="table-empty">
                  {rows.length ? 'Không có lịch sử trong khoảng ngày đã chọn' : 'Chưa có lịch sử thao tác'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="history-success-summary">
        <div className="history-success-summary-label">
          <CircleCheckBig size={18} aria-hidden="true" />
          <span>Tổng comment thành công</span>
        </div>
        <strong>{successfulCount}</strong>
        <small>trên {filteredRows.length} bản ghi đang hiển thị</small>
      </div>
      {status ? <div className="module-status">{status}</div> : null}
      {exportError ? <div className="module-status history-export-error">{exportError}</div> : null}
    </section>
  );
}
