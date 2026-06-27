'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Clock3, FileText, MessageSquare, Pencil, Plus, RotateCcw, SendHorizontal, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { viewToPath } from '@/lib/app-routes';
import type { StaffAccount } from '@/lib/types';
import './content-plan-panel.css';

type PlanColumn = 0 | 1 | 2 | 3;
type PlanTaskStatus = 'todo' | 'doing' | 'pending' | 'approved' | 'archived';

type PlanScriptStatus = 'draft' | 'pending' | 'approved';

type PlanScript = {
  id: string;
  title: string;
  platform: string;
  status: PlanScriptStatus;
  writer: string;
};

type PlanTask = {
  id: string;
  col: PlanColumn;
  status?: PlanTaskStatus;
  title: string;
  assignee: string;
  dl: string;
  pri: string;
  color: string;
  script_id?: string;
  platform?: string;
  notes?: Array<{ id: string; text: string; at: string; staff_name?: string }>;
  timeline?: Array<{ id: string; kind: string; label: string; at: string; staff_name?: string }>;
};

type ArchivedTask = PlanTask & { archivedAt: string };

type PlanMember = {
  id: string;
  name: string;
  role: string;
  color: string;
};

type PlanViewMode = 'all' | 'todo' | 'doing' | 'done' | 'archive';
type BottomTab = 'activity' | 'perf';

const STORAGE_KEY = 'content-plan-v1';

const MEMBER_COLORS = ['#7C6CF0', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

const KANBAN_COLUMNS: Array<{ id: PlanColumn; label: string; color: string }> = [
  { id: 0, label: 'Chưa làm', color: '#9CA3AF' },
  { id: 1, label: 'Đang làm', color: '#7C6CF0' },
  { id: 2, label: 'Chờ duyệt', color: '#F59E0B' },
  { id: 3, label: 'Xong', color: '#10B981' },
];

function staffRowsToMembers(rows: StaffAccount[]): PlanMember[] {
  return rows
    .filter((item) => item.enabled !== false && String(item.name || item.username || '').trim())
    .map((item, index) => ({
      id: String(item.id || item.username || index),
      name: String(item.name || item.username || '').trim(),
      role: item.role === 'admin' ? 'Admin' : 'Nhân sự',
      color: MEMBER_COLORS[index % MEMBER_COLORS.length],
    }));
}

const DEFAULT_TASKS: PlanTask[] = [
  { id: 't1', col: 0, title: 'Kế hoạch content tuần 3', assignee: 'Dung', dl: '2026-06-15', pri: '🟡', color: MEMBER_COLORS[3] },
  { id: 't2', col: 1, title: 'Viết 5 script TikTok guitar', assignee: 'Bình', dl: '2026-06-05', pri: '🔴', color: MEMBER_COLORS[1] },
  { id: 't3', col: 1, title: 'Edit video review acoustic', assignee: 'Chi', dl: '2026-06-06', pri: '🟡', color: MEMBER_COLORS[2] },
  { id: 't4', col: 1, title: 'Thiết kế thumbnail tuần này', assignee: 'Dung', dl: '2026-06-04', pri: '🟢', color: MEMBER_COLORS[3] },
  { id: 't5', col: 2, title: 'Script Reels chăm sóc đàn', assignee: 'An', dl: '2026-06-03', pri: '🟡', color: MEMBER_COLORS[0] },
  { id: 't6', col: 3, title: 'Script top 10 guitar', assignee: 'An', dl: '2026-06-01', pri: '🔴', color: MEMBER_COLORS[0] },
];

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseDate(value: string) {
  if (!value || value === '--') return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const date = new Date(iso || value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dlToInputValue(dl: string) {
  const date = parseDate(dl);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deadlineClass(dl: string) {
  const date = parseDate(dl);
  if (!date) return 'dl-none';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  const diff = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'dl-red';
  if (diff <= 3) return 'dl-yellow';
  return 'dl-green';
}

function deadlineBadge(dl: string) {
  const date = parseDate(dl);
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { tone: 'red' as const, text: `Quá hạn ${Math.abs(diff)}N` };
  if (diff === 0) return { tone: 'red' as const, text: 'Hôm nay!' };
  if (diff <= 3) return { tone: 'yellow' as const, text: `Còn ${diff}N` };
  return { tone: 'green' as const, text: date.toLocaleDateString('vi-VN') };
}

function inDateRange(dl: string, from: string, to: string) {
  if (!from && !to) return true;
  const date = parseDate(dl);
  if (!date) return true;
  if (from && date < new Date(from)) return false;
  if (to && date > new Date(to)) return false;
  return true;
}

function activityLabel(title: string) {
  const lower = title.toLocaleLowerCase('vi');
  if (lower.includes('script')) return 'Viết script';
  if (lower.includes('edit')) return 'Edit';
  if (lower.includes('thiết kế') || lower.includes('thumb')) return 'Design';
  if (lower.includes('content')) return 'Content';
  return 'Đang làm';
}

function normalizePlanTitle(value: string) {
  return value
    .toLocaleLowerCase('vi')
    .replace(/^script\s+/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function planColFromScriptStatus(status: PlanScriptStatus): PlanColumn {
  if (status === 'approved') return 3;
  if (status === 'pending') return 2;
  if (status === 'draft') return 1;
  return 1;
}

function statusFromCol(col: PlanColumn): PlanTaskStatus {
  if (col === 3) return 'approved';
  if (col === 2) return 'pending';
  if (col === 1) return 'doing';
  return 'todo';
}

function formatLogTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function findScriptForTask(task: PlanTask, scripts: PlanScript[]) {
  if (task.script_id) {
    const linked = scripts.find((item) => item.id === task.script_id);
    if (linked) return linked;
  }
  const taskTitle = normalizePlanTitle(task.title);
  if (!taskTitle) return null;
  return scripts.find((script) => {
    const scriptTitle = normalizePlanTitle(script.title);
    return scriptTitle.includes(taskTitle) || taskTitle.includes(scriptTitle);
  }) || null;
}

type StoredPlan = {
  tasks: PlanTask[];
  archived: ArchivedTask[];
};

function readStoredPlan(): StoredPlan {
  if (typeof window === 'undefined') {
    return { tasks: DEFAULT_TASKS, archived: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tasks: DEFAULT_TASKS, archived: [] };
    const parsed = JSON.parse(raw) as Partial<StoredPlan>;
    return {
      tasks: Array.isArray(parsed.tasks) && parsed.tasks.length ? parsed.tasks : DEFAULT_TASKS,
      archived: Array.isArray(parsed.archived) ? parsed.archived : [],
    };
  } catch {
    return { tasks: DEFAULT_TASKS, archived: [] };
  }
}

export function ContentPlanPanel() {
  const router = useRouter();
  const [tasks, setTasks] = useState<PlanTask[]>(DEFAULT_TASKS);
  const [archived, setArchived] = useState<ArchivedTask[]>([]);
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [membersStatus, setMembersStatus] = useState('Đang tải nhân sự...');
  const [scripts, setScripts] = useState<PlanScript[]>([]);
  const [scriptsStatus, setScriptsStatus] = useState('');
  const [viewMode, setViewMode] = useState<PlanViewMode>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('Tất cả');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bottomTab, setBottomTab] = useState<BottomTab>('activity');
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newCol, setNewCol] = useState<PlanColumn>(0);
  const [newDl, setNewDl] = useState('');
  const [newPri, setNewPri] = useState('🟡');
  const [newScriptId, setNewScriptId] = useState('');
  const [notice, setNotice] = useState('');
  const [notesTaskId, setNotesTaskId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [highlightTaskId, setHighlightTaskId] = useState('');

  const persist = useCallback((nextTasks: PlanTask[], nextArchived: ArchivedTask[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: nextTasks, archived: nextArchived }));
    } catch {
      /* ignore */
    }
    void api('/api/content-tasks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: nextTasks }),
      timeoutMs: 30000,
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Không lưu được task lên Supabase');
      }
      if (Array.isArray(payload.tasks) && payload.tasks.length) {
        setTasks(payload.tasks as PlanTask[]);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: payload.tasks, archived: nextArchived }));
        } catch {
          /* ignore */
        }
      }
      if (payload.warning) setScriptsStatus(payload.warning);
      return payload;
    }).then(async (payload) => {
      const rows = Array.isArray(payload?.tasks) ? payload.tasks as PlanTask[] : nextTasks;
      const needsScripts = rows.some((task) => (task.col === 1 || task.col === 2 || task.status === 'doing' || task.status === 'pending'));
      if (!needsScripts) return;
      try {
        const response = await api('/api/scripts?lite=1', { timeoutMs: 20000 });
        const scriptPayload = await response.json().catch(() => ({}));
        if (response.ok && scriptPayload.ok && Array.isArray(scriptPayload.scripts)) {
          setScripts(scriptPayload.scripts as PlanScript[]);
          setScriptsStatus(`${scriptPayload.scripts.length} kịch bản`);
        }
      } catch {
        /* ignore */
      }
    }).catch((error) => {
      setScriptsStatus(error instanceof Error ? error.message : 'Không lưu được task lên Supabase');
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStaffMembers() {
      setMembersStatus('Đang tải nhân sự...');
      try {
        const response = await api('/api/staff-cookies', { timeoutMs: 30000 });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(payload.error || 'Không tải được nhân sự');
        }
        const nextMembers = staffRowsToMembers(Array.isArray(payload.staff) ? payload.staff as StaffAccount[] : []);
        setMembers(nextMembers);
        setMembersStatus(nextMembers.length ? '' : 'Chưa có nhân sự — thêm tại /nhan-su');
        if (nextMembers.length) {
          setNewAssignee((current) => (
            current && nextMembers.some((member) => member.name === current) ? current : nextMembers[0].name
          ));
        }
        if (payload.warning) {
          setScriptsStatus((current) => current || String(payload.warning));
        }
      } catch (error) {
        if (cancelled) return;
        setMembers([]);
        setMembersStatus(error instanceof Error ? error.message : 'Không tải được nhân sự');
      }
    }
    void loadStaffMembers();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const stored = readStoredPlan();
    setTasks(stored.tasks);
    setArchived(stored.archived);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPlanData() {
      setScriptsStatus('Đang tải...');
      try {
        const [tasksResponse, scriptsResponse] = await Promise.all([
          api('/api/content-tasks?lite=1', { timeoutMs: 30000 }),
          api('/api/scripts?lite=1', { timeoutMs: 20000 }),
        ]);
        const tasksPayload = await tasksResponse.json().catch(() => ({}));
        const scriptsPayload = await scriptsResponse.json().catch(() => ({}));
        if (cancelled) return;
        if (!tasksResponse.ok || !tasksPayload.ok) {
          throw new Error(tasksPayload.error || 'Không tải được task');
        }
        const rows = Array.isArray(tasksPayload.tasks) ? tasksPayload.tasks as PlanTask[] : [];
        if (rows.length) {
          setTasks(rows);
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: rows, archived }));
          } catch {
            /* ignore */
          }
        }
        if (scriptsResponse.ok && scriptsPayload.ok) {
          const scriptRows = Array.isArray(scriptsPayload.scripts) ? scriptsPayload.scripts as PlanScript[] : [];
          setScripts(scriptRows);
          setScriptsStatus(scriptRows.length ? `${scriptRows.length} kịch bản` : 'Chưa có kịch bản');
        } else {
          setScriptsStatus(scriptsPayload.error || 'Không tải được kịch bản');
        }
        const warning = [tasksPayload.warning, scriptsPayload.warning].filter(Boolean).join(' · ');
        if (warning) setScriptsStatus(warning);
      } catch (error) {
        if (!cancelled) {
          setScriptsStatus(error instanceof Error ? error.message : 'Không tải được dữ liệu kế hoạch');
        }
      }
    }
    void loadPlanData();
    return () => { cancelled = true; };
  }, [archived]);

  useEffect(() => {
    if (!scripts.length) return;
    let changed = false;
    const next = tasks.map((task) => {
      const script = findScriptForTask(task, scripts);
      if (!script) return task;
      const col = planColFromScriptStatus(script.status);
      if (task.script_id === script.id && task.col === col) return task;
      changed = true;
      return { ...task, script_id: script.id, col, status: statusFromCol(col) };
    });
    if (!changed) return;
    updateTasks(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const taskId = new URLSearchParams(window.location.search).get('task')?.trim() || '';
    if (!taskId) return;
    setHighlightTaskId(taskId);
    setViewMode('all');
    window.setTimeout(() => {
      document.querySelector(`[data-plan-task-id="${taskId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }, [tasks]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visibleColumns = useMemo(() => {
    if (viewMode === 'archive') return [];
    const map: Record<Exclude<PlanViewMode, 'archive'>, PlanColumn[]> = {
      all: [0, 1, 2, 3],
      todo: [0],
      doing: [1, 2],
      done: [3],
    };
    return map[viewMode as Exclude<PlanViewMode, 'archive'>] || [0, 1, 2, 3];
  }, [viewMode]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (assigneeFilter !== 'Tất cả' && task.assignee !== assigneeFilter) return false;
      return inDateRange(task.dl, dateFrom, dateTo);
    });
  }, [assigneeFilter, dateFrom, dateTo, tasks]);

  function updateTasks(next: PlanTask[]) {
    setTasks(next);
    persist(next, archived);
  }

  function updateArchived(next: ArchivedTask[]) {
    setArchived(next);
    persist(tasks, next);
  }

  function moveTask(taskId: string, col: PlanColumn) {
    const next = tasks.map((task) => (task.id === taskId ? { ...task, col, status: statusFromCol(col) } : task));
    updateTasks(next);
    if (col === 1 || col === 2) {
      setNotice(col === 1 ? 'Đã chuyển Đang làm — đồng bộ kịch bản...' : 'Đã chuyển Chờ duyệt — đồng bộ kịch bản...');
    }
  }

  function deleteTask(taskId: string) {
    if (!window.confirm('Xóa task?')) return;
    updateTasks(tasks.filter((task) => task.id !== taskId));
    setNotice('Đã xóa task.');
  }

  function archiveTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const nextArchived = [...archived, { ...task, archivedAt: new Date().toLocaleDateString('vi-VN') }];
    const nextTasks = tasks.filter((item) => item.id !== taskId);
    setArchived(nextArchived);
    setTasks(nextTasks);
    persist(nextTasks, nextArchived);
    setNotice('Đã lưu trữ task.');
  }

  function archiveDone() {
    const done = tasks.filter((task) => task.col === 3);
    if (!done.length) {
      setNotice('Không có task Xong.');
      return;
    }
    if (!window.confirm(`Lưu trữ ${done.length} task Xong?`)) return;
    const nextArchived = [
      ...archived,
      ...done.map((task) => ({ ...task, archivedAt: new Date().toLocaleDateString('vi-VN') })),
    ];
    const nextTasks = tasks.filter((task) => task.col !== 3);
    setArchived(nextArchived);
    setTasks(nextTasks);
    persist(nextTasks, nextArchived);
    setNotice(`Đã lưu trữ ${done.length} task.`);
  }

  function restoreArchived(index: number) {
    const item = archived[index];
    if (!item) return;
    const nextArchived = archived.filter((_, i) => i !== index);
    const nextTasks = [...tasks, { ...item, id: newId('task') }];
    setArchived(nextArchived);
    setTasks(nextTasks);
    persist(nextTasks, nextArchived);
    setNotice('Đã khôi phục task.');
  }

  function deleteArchived(index: number) {
    if (!window.confirm('Xóa vĩnh viễn?')) return;
    updateArchived(archived.filter((_, i) => i !== index));
  }

  function clearArchive() {
    if (!window.confirm('Xóa tất cả lưu trữ?')) return;
    updateArchived([]);
    setNotice('Đã xóa lưu trữ.');
  }

  function openTaskModal(col: PlanColumn = 0) {
    setEditingTaskId('');
    setNewCol(col);
    setNewTitle('');
    setNewAssignee(members[0]?.name || '');
    setNewDl('');
    setNewPri('🟡');
    setNewScriptId('');
    setShowTaskModal(true);
  }

  function openEditTask(task: PlanTask) {
    setEditingTaskId(task.id);
    setNewCol(task.col);
    setNewTitle(task.title);
    setNewAssignee(task.assignee);
    setNewDl(dlToInputValue(task.dl));
    setNewPri(task.pri || '🟡');
    setNewScriptId(task.script_id || '');
    setShowTaskModal(true);
  }

  function openScript(scriptId: string) {
    if (!scriptId) return;
    router.push(`${viewToPath('scripts')}?script=${encodeURIComponent(scriptId)}`);
  }

  function resolveTaskScript(task: PlanTask) {
    return findScriptForTask(task, scripts);
  }

  const notesTask = useMemo(() => tasks.find((task) => task.id === notesTaskId) || null, [notesTaskId, tasks]);

  function openNotes(task: PlanTask) {
    setNotesTaskId(task.id);
    setNoteText('');
    if (task.notes?.length) return;
    void api(`/api/content-tasks/${encodeURIComponent(task.id)}`, { timeoutMs: 15000 })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok || !payload.task) return;
        const updated = payload.task as PlanTask;
        setTasks((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      })
      .catch(() => {
        /* ignore */
      });
  }

  async function sendTaskNote() {
    const task = notesTask;
    const text = noteText.trim();
    if (!task || !text) return;

    const optimisticId = `note-${Date.now()}`;
    const optimisticNote = {
      id: optimisticId,
      text,
      at: new Date().toISOString(),
      staff_name: 'Bạn',
    };

    setTasks((current) => current.map((item) => (
      item.id === task.id
        ? { ...item, notes: [...(item.notes || []), optimisticNote] }
        : item
    )));
    setNoteText('');
    setNoteBusy(true);

    try {
      const response = await api(`/api/content-tasks/${encodeURIComponent(task.id)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        timeoutMs: 15000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không lưu được ghi chú');
      if (payload.task) {
        const updated = payload.task as PlanTask;
        setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        try {
          const stored = readStoredPlan();
          const nextTasks = stored.tasks.map((item) => (item.id === updated.id ? updated : item));
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: nextTasks, archived }));
        } catch {
          /* ignore */
        }
      }
      if (payload.warning) setScriptsStatus(payload.warning);
    } catch (error) {
      setTasks((current) => current.map((item) => (
        item.id === task.id
          ? { ...item, notes: (item.notes || []).filter((note) => note.id !== optimisticId) }
          : item
      )));
      setNoteText(text);
      setNotice(error instanceof Error ? error.message : 'Không lưu được ghi chú');
    } finally {
      setNoteBusy(false);
    }
  }

  async function ensureScriptForTask(task: PlanTask) {
    try {
      setNotice('Đang chuẩn bị kịch bản...');
      const response = await api(`/api/content-tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'doing', col: 1 }),
        timeoutMs: 30000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không chuẩn bị được kịch bản');

      const taskRows = Array.isArray(payload.tasks) ? payload.tasks as PlanTask[] : [];
      const updatedTask = (payload.task as PlanTask | undefined)
        || taskRows.find((item) => item.id === task.id);
      if (taskRows.length) setTasks(taskRows);

      const scriptsResponse = await api('/api/scripts?lite=1', { timeoutMs: 30000 });
      const scriptsPayload = await scriptsResponse.json().catch(() => ({}));
      if (!scriptsResponse.ok || !scriptsPayload.ok) {
        throw new Error(scriptsPayload.error || 'Không tải được kịch bản vừa tạo');
      }
      const scriptRows = Array.isArray(scriptsPayload.scripts) ? scriptsPayload.scripts as PlanScript[] : [];
      setScripts(scriptRows);
      const scriptId = updatedTask?.script_id
        || taskRows.find((item) => item.id === task.id)?.script_id
        || findScriptForTask({ ...task, col: 1, status: 'doing' }, scriptRows)?.id;
      if (!scriptId) throw new Error('Task chưa liên kết được với kịch bản');
      openScript(scriptId);
      setNotice('Đã mở kịch bản của task.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Không chuẩn bị được kịch bản');
    }
  }

  function handleTaskScriptAction(task: PlanTask) {
    const script = resolveTaskScript(task);
    const scriptId = script?.id || task.script_id;
    if (scriptId) {
      if (task.col === 0) moveTask(task.id, 1);
      openScript(scriptId);
      return;
    }
    void ensureScriptForTask(task);
  }

  function startTask(task: PlanTask) {
    handleTaskScriptAction(task);
  }

  function approveTask(task: PlanTask) {
    moveTask(task.id, 3);
    setNotice('Đã duyệt task.');
  }

  function saveTask() {
    const title = newTitle.trim();
    if (!title) {
      setNotice('Nhập tên task.');
      return;
    }
    if (!newAssignee) {
      setNotice('Chưa có nhân sự để giao task. Thêm tại /nhan-su.');
      return;
    }
    const member = members.find((item) => item.name === newAssignee);
    const fields = {
      col: newCol,
      status: statusFromCol(newCol),
      title,
      assignee: newAssignee,
      dl: newDl || '--',
      pri: newPri,
      color: member?.color || MEMBER_COLORS[0],
      script_id: newScriptId || undefined,
    };
    if (editingTaskId) {
      const next = tasks.map((task) => (task.id === editingTaskId ? { ...task, ...fields } : task));
      updateTasks(next);
      setShowTaskModal(false);
      setEditingTaskId('');
      setNotice('Đã cập nhật task.');
      return;
    }
    const next: PlanTask = {
      id: newId('task'),
      ...fields,
    };
    updateTasks([...tasks, next]);
    setShowTaskModal(false);
    setNotice('Đã thêm task.');
  }

  const activityCards = useMemo(() => {
    return members.map((member) => {
      const doing = tasks.filter((task) => task.assignee === member.name && task.col === 1);
      const pending = tasks.filter((task) => task.assignee === member.name && task.col === 2);
      let status = 'Rảnh';
      let statusTone = 'idle';
      let taskTitle = 'Chưa có task';
      if (doing.length) {
        status = activityLabel(doing[0].title);
        statusTone = 'doing';
        taskTitle = doing[0].title;
      } else if (pending.length) {
        status = 'Chờ duyệt';
        statusTone = 'pending';
        taskTitle = pending[0].title;
      }
      return { member, status, statusTone, taskTitle };
    });
  }, [members, tasks]);

  const perfRows = useMemo(() => {
    return members.map((member) => {
      const all = tasks.filter((task) => task.assignee === member.name);
      const total = all.length || 1;
      const done = all.filter((task) => task.col === 3).length;
      const doing = all.filter((task) => task.col === 1).length;
      const review = all.filter((task) => task.col === 2).length;
      const todo = all.filter((task) => task.col === 0).length;
      const archivedCount = archived.filter((task) => task.assignee === member.name).length;
      const kpiPct = Math.min(100, Math.round((done / total) * 100));
      return { member, total, done, doing, review, todo, archivedCount, kpiPct };
    });
  }, [archived, members, tasks]);

  return (
    <section className="content-plan" aria-label="Kế hoạch content">
      <div className="content-plan-toolbar">
        <div className="content-plan-tabs" role="tablist">
          {([
            ['all', 'Tất cả'],
            ['todo', 'Chưa làm'],
            ['doing', 'Đang làm'],
            ['done', 'Xong'],
            ['archive', 'Lưu trữ'],
          ] as Array<[PlanViewMode, string]>).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={viewMode === mode}
              className={viewMode === mode ? 'active' : ''}
              onClick={() => setViewMode(mode)}
            >
              {mode === 'archive' ? <><Archive /> {label}</> : label}
            </button>
          ))}
        </div>

        {membersStatus ? <span className="content-plan-members-status">{membersStatus}</span> : null}

        {viewMode !== 'archive' ? (
          <>
            <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} aria-label="Lọc người phụ trách">
              <option>Tất cả</option>
              {members.map((member) => (
                <option key={member.id} value={member.name}>{member.name}</option>
              ))}
            </select>
            <div className="content-plan-dates">
              <span>Từ</span>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              <span>đến</span>
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              <button type="button" className="content-plan-clear-dates" onClick={() => { setDateFrom(''); setDateTo(''); }}>✕</button>
            </div>
          </>
        ) : null}

        <div className="content-plan-toolbar-spacer" />

        {viewMode !== 'archive' ? (
          <>
            <button type="button" className="content-plan-btn ghost" onClick={() => router.push(viewToPath('scripts'))}>
              <FileText /> Kịch bản
            </button>
            <button type="button" className="content-plan-btn archive" onClick={archiveDone}>
              <Archive /> Lưu Xong
            </button>
            <button type="button" className="content-plan-btn primary" onClick={() => openTaskModal(0)}>
              <Plus /> Task
            </button>
          </>
        ) : null}
        {scriptsStatus ? <span className="content-plan-scripts-status">{scriptsStatus}</span> : null}
      </div>

      {viewMode === 'archive' ? (
        <div className="content-plan-archive">
          {archived.length ? (
            <>
              <div className="content-plan-archive-head">
                <strong>{archived.length} task đã lưu trữ</strong>
                <button type="button" className="content-plan-btn danger" onClick={clearArchive}>
                  <Trash2 /> Xóa tất cả
                </button>
              </div>
              {archived.map((task, index) => (
                <div className="content-plan-archive-item" key={`${task.id}-${index}`}>
                  <div className="content-plan-avatar" style={{ background: task.color }}>{task.assignee[0]}</div>
                  <div className="content-plan-archive-body">
                    <strong>{task.title}</strong>
                    <span>{task.assignee} · {KANBAN_COLUMNS[task.col]?.label} · DL: {task.dl} · Lưu: {task.archivedAt}</span>
                  </div>
                  <button type="button" className="content-plan-icon-btn" title="Khôi phục" onClick={() => restoreArchived(index)}>
                    <RotateCcw />
                  </button>
                  <button type="button" className="content-plan-icon-btn danger" title="Xóa" onClick={() => deleteArchived(index)}>
                    <X />
                  </button>
                </div>
              ))}
            </>
          ) : (
            <div className="content-plan-empty">Chưa có task lưu trữ</div>
          )}
        </div>
      ) : (
        <div className="content-plan-board">
          {KANBAN_COLUMNS.filter((column) => visibleColumns.includes(column.id)).map((column) => {
            const columnTasks = filteredTasks.filter((task) => task.col === column.id);
            return (
              <div
                key={column.id}
                className="content-plan-column"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (!dragTaskId) return;
                  moveTask(dragTaskId, column.id);
                  setDragTaskId(null);
                }}
              >
                <div className="content-plan-column-head">
                  <span>{column.label}</span>
                  <em style={{ background: `${column.color}20`, color: column.color }}>{columnTasks.length}</em>
                </div>
                <div className="content-plan-column-scroll">
                  {columnTasks.map((task) => {
                    const badge = deadlineBadge(task.dl);
                    const linkedScript = resolveTaskScript(task);
                    return (
                      <div
                        key={task.id}
                        data-plan-task-id={task.id}
                        className={`content-plan-card ${deadlineClass(task.dl)}${linkedScript ? ' has-script' : ''}${highlightTaskId === task.id ? ' highlight-task' : ''}`}
                        draggable
                        onDragStart={() => setDragTaskId(task.id)}
                        onDragEnd={() => setDragTaskId(null)}
                      >
                        <div className="content-plan-card-top">
                          <button
                            type="button"
                            className="content-plan-card-title"
                            onClick={() => handleTaskScriptAction(task)}
                            title={linkedScript ? `Mở kịch bản: ${linkedScript.title}` : 'Tạo và mở kịch bản'}
                          >
                            {task.title}
                          </button>
                        </div>
                        {linkedScript ? (
                          <div className="content-plan-script-chip">
                            {linkedScript.title} · {linkedScript.status === 'approved' ? 'Đã duyệt' : linkedScript.status === 'pending' ? 'Chờ duyệt' : 'Nháp'}
                          </div>
                        ) : null}
                        <div className="content-plan-card-body">
                          <div className="content-plan-card-meta-line">
                            <span className="content-plan-avatar sm" style={{ background: task.color }}>{task.assignee[0]}</span>
                            <span className="content-plan-card-assignee">{task.assignee}</span>
                          </div>
                          <div className="content-plan-card-meta-line">
                            {badge ? <span className={`content-plan-dl ${badge.tone}`}>{badge.text}</span> : null}
                            <span className="content-plan-card-pri">{task.pri}</span>
                          </div>
                        </div>
                        <div className="content-plan-card-quick">
                          <button
                            type="button"
                            className="content-plan-script-btn"
                            title={linkedScript ? 'Mở kịch bản' : 'Tạo kịch bản'}
                            onClick={() => handleTaskScriptAction(task)}
                          >
                            <FileText />
                          </button>
                          <button
                            type="button"
                            className="content-plan-script-btn note"
                            title="Ghi chú & timeline"
                            onClick={() => openNotes(task)}
                          >
                            <MessageSquare />
                            {task.notes?.length ? <em>{task.notes.length}</em> : null}
                          </button>
                        </div>
                        <div className="content-plan-card-actions">
                          {column.id === 3 ? (
                            <button type="button" className="content-plan-mini-action" title="Lưu trữ" onClick={() => archiveTask(task.id)}>
                              <Archive /> Lưu
                            </button>
                          ) : null}
                          {column.id === 0 ? (
                            <button type="button" className="content-plan-mini-action" onClick={() => startTask(task)}>
                              Đang làm
                            </button>
                          ) : null}
                          {column.id === 2 ? (
                            <button type="button" className="content-plan-mini-action approve" onClick={() => approveTask(task)}>
                              Duyệt
                            </button>
                          ) : null}
                          <button type="button" className="content-plan-card-action edit" onClick={() => openEditTask(task)}>
                            <Pencil /> Sửa
                          </button>
                          <button type="button" className="content-plan-card-action delete" onClick={() => deleteTask(task.id)}>
                            <Trash2 /> Xóa
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="content-plan-add" onClick={() => openTaskModal(column.id)}>
                  + Thêm
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="content-plan-bottom">
        <div className="content-plan-bottom-tabs">
          <button type="button" className={bottomTab === 'activity' ? 'active' : ''} onClick={() => setBottomTab('activity')}>
            Đang làm gì
          </button>
          <button type="button" className={bottomTab === 'perf' ? 'active' : ''} onClick={() => setBottomTab('perf')}>
            Hiệu suất
          </button>
        </div>

        {bottomTab === 'activity' ? (
          <div className="content-plan-activity-grid">
            {!members.length ? <p className="content-plan-members-empty">{membersStatus || 'Chưa có nhân sự — thêm tại /nhan-su'}</p> : null}
            {activityCards.map(({ member, status, statusTone, taskTitle }) => (
              <div className="content-plan-activity-card" key={member.id}>
                <div className="content-plan-avatar" style={{ background: member.color }}>{member.name[0]}</div>
                <div>
                  <div className={`content-plan-activity-status ${statusTone}`}>{status}</div>
                  <strong>{member.name}</strong>
                  <p>{taskTitle}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="content-plan-perf">
            {!members.length ? <p className="content-plan-members-empty">{membersStatus || 'Chưa có nhân sự — thêm tại /nhan-su'}</p> : null}
            {perfRows.map(({ member, total, done, doing, review, todo, archivedCount, kpiPct }) => (
              <div className="content-plan-perf-row" key={member.id}>
                <div className="content-plan-perf-name">{member.name}</div>
                <div className="content-plan-perf-bar-wrap">
                  <div className="content-plan-perf-bar">
                    <span style={{ width: `${Math.round((done / total) * 100)}%`, background: '#10B981' }} />
                    <span style={{ width: `${Math.round((doing / total) * 100)}%`, background: '#7C6CF0' }} />
                    <span style={{ width: `${Math.round((review / total) * 100)}%`, background: '#F59E0B' }} />
                    <span style={{ flex: 1, background: '#E5E7EB' }} />
                  </div>
                  <div className="content-plan-perf-stats">
                    <span>✅ {done}</span>
                    <span>🔄 {doing}</span>
                    <span>👀 {review}</span>
                    <span>⬜ {todo}</span>
                    {archivedCount ? <span>🗄 {archivedCount}</span> : null}
                  </div>
                </div>
                <div className={`content-plan-kpi ${kpiPct >= 100 ? 'ok' : kpiPct >= 70 ? 'warn' : 'bad'}`}>{kpiPct}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showTaskModal ? (
        <div className="content-plan-modal-backdrop" role="presentation" onMouseDown={() => setShowTaskModal(false)}>
          <div className="content-plan-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="content-plan-modal-head">
              <strong>{editingTaskId ? 'Sửa task' : 'Task mới'}</strong>
              <button type="button" onClick={() => { setShowTaskModal(false); setEditingTaskId(''); }}><X /></button>
            </div>
            <label>
              Tên task
              <input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="VD: Viết 5 script TikTok tuần 3" />
            </label>
            <div className="content-plan-modal-grid">
              <label>
                Giao cho
                <select value={newAssignee} onChange={(event) => setNewAssignee(event.target.value)} disabled={!members.length}>
                  {!members.length ? <option value="">Chưa có nhân sự</option> : null}
                  {members.map((member) => (
                    <option key={member.id} value={member.name}>{member.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Cột
                <select value={newCol} onChange={(event) => setNewCol(Number(event.target.value) as PlanColumn)}>
                  {KANBAN_COLUMNS.map((column) => (
                    <option key={column.id} value={column.id}>{column.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="content-plan-modal-grid">
              <label>
                Deadline
                <input type="date" value={newDl} onChange={(event) => setNewDl(event.target.value)} />
              </label>
              <label>
                Ưu tiên
                <select value={newPri} onChange={(event) => setNewPri(event.target.value)}>
                  <option value="🔴">🔴 Cao</option>
                  <option value="🟡">🟡 Trung bình</option>
                  <option value="🟢">🟢 Thấp</option>
                </select>
              </label>
            </div>
            <label>
              Liên kết kịch bản
              <select value={newScriptId} onChange={(event) => setNewScriptId(event.target.value)}>
                <option value="">— Chưa chọn —</option>
                {scripts.map((script) => (
                  <option key={script.id} value={script.id}>{script.title}</option>
                ))}
              </select>
            </label>
            <div className="content-plan-modal-actions">
              <button type="button" onClick={() => { setShowTaskModal(false); setEditingTaskId(''); }}>Hủy</button>
              <button type="button" className="content-plan-btn primary" onClick={saveTask}>{editingTaskId ? 'Lưu' : 'Thêm'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {notesTask ? (
        <div className="content-plan-modal-backdrop" role="presentation" onMouseDown={() => setNotesTaskId('')}>
          <div className="content-plan-modal content-plan-notes-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="content-plan-modal-head">
              <div>
                <strong>Ghi chú task</strong>
                <span>{notesTask.title}</span>
              </div>
              <button type="button" onClick={() => setNotesTaskId('')}><X /></button>
            </div>

            <div className="content-plan-notes-layout">
              <section className="content-plan-note-chat" aria-label="Chat ghi chú">
                <div className="content-plan-note-list">
                  {notesTask.notes?.length ? (
                    notesTask.notes.map((note) => (
                      <div className="content-plan-note-bubble" key={note.id || `${note.at}-${note.text}`}>
                        <div>
                          <strong>{note.staff_name || 'Nhân sự'}</strong>
                          <span>{formatLogTime(note.at)}</span>
                        </div>
                        <p>{note.text}</p>
                      </div>
                    ))
                  ) : (
                    <div className="content-plan-note-empty">Chưa có ghi chú trao đổi.</div>
                  )}
                </div>
                <div className="content-plan-note-compose">
                  <textarea
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    placeholder="Nhập phản hồi, ví dụ: Em sửa rồi / Cần chỉnh lại hook..."
                    rows={3}
                  />
                  <button type="button" className="content-plan-btn primary" disabled={noteBusy || !noteText.trim()} onClick={() => void sendTaskNote()}>
                    <SendHorizontal /> Gửi
                  </button>
                </div>
              </section>

              <section className="content-plan-timeline" aria-label="Timeline task">
                <div className="content-plan-timeline-head">
                  <Clock3 />
                  <strong>Mốc thời gian</strong>
                </div>
                {notesTask.timeline?.length ? (
                  notesTask.timeline.map((item) => (
                    <div className="content-plan-timeline-item" key={item.id || `${item.kind}-${item.at}`}>
                      <span />
                      <div>
                        <strong>{item.label || item.kind}</strong>
                        <p>{formatLogTime(item.at)}{item.staff_name ? ` · ${item.staff_name}` : ''}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="content-plan-note-empty">Chưa có timeline.</div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {notice ? <div className="content-plan-toast">{notice}</div> : null}
    </section>
  );
}
