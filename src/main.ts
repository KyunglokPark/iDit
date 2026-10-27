import "./styles.css";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { open as openDialog, save as saveDialog, ask, message } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { languageFromPath } from "./langs";
import { ftpOpenFlow, ftpSaveFlow, ftpSaveTo } from "./ftp-ui";
import { pickEncoding } from "./encoding-ui";
import { pickFont } from "./font-ui";
import { initMenuBar } from "./menu";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

const appWindow = getCurrentWindow();

const editorEl = document.getElementById("editor") as HTMLDivElement;
const tabbarEl = document.getElementById("tabbar") as HTMLDivElement;
const stPathEl = document.getElementById("st-path") as HTMLSpanElement;
const stLangEl = document.getElementById("st-lang") as HTMLSpanElement;
const stTabEl = document.getElementById("st-tabsize") as HTMLSpanElement;
const stEncodingEl = document.getElementById("st-encoding") as HTMLSpanElement;
const stPosEl = document.getElementById("st-pos") as HTMLSpanElement;

const DEFAULT_FONT_FAMILY = "Consolas, 'Courier New', monospace";
let fontFamily = localStorage.getItem("idit.fontFamily") || DEFAULT_FONT_FAMILY;
let fontSize = parseInt(localStorage.getItem("idit.fontSize") || "14", 10) || 14;
let tabWidth = parseInt(localStorage.getItem("idit.tabSize") || "2", 10) || 2;

const editor = monaco.editor.create(editorEl, {
  theme: "vs-dark",
  automaticLayout: true,
  fontSize,
  fontFamily,
  minimap: { enabled: true },
  tabSize: tabWidth,
  // 스크롤바를 iDOT처럼 얇게 (Monaco 기본 세로 14px → 10px)
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  // 줄번호 칸을 3자리 기준으로 좁힌다 (기본값 5). 줄 수가 999를 넘으면
  // Monaco가 자릿수에 맞춰 자동으로 넓혀준다.
  lineNumbersMinChars: 3,
  // 줄번호와 본문 사이 공백 축소(기본 10) + 왼쪽 글리프 마진 제거.
  lineDecorationsWidth: 6,
  glyphMargin: false,
  wordWrap: "off",
  renderWhitespace: "selection",
  scrollBeyondLastLine: false,
  fixedOverflowWidgets: true,
  // Monaco 기본값(true)은 찾기 위젯이 첫 줄을 가리지 않게 본문 위에 빈 공간을
  // 밀어 넣는다 — 그게 "에디터가 내려간다"로 보였던 원인. 꺼서 위젯이 그냥
  // 코드 위에 겹쳐서만 뜨고 본문은 그대로 있게 한다.
  find: { addExtraSpaceOnTop: false },
});

type RemoteSource = { protocol: "ftp" | "sftp"; host: string; port: number; path: string };

interface Tab {
  id: number;
  model: monaco.editor.ITextModel;
  path: string | null;
  ftp: RemoteSource | null;
  encoding: string;
  savedVersionId: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
}

const tabs: Tab[] = [];
let activeTabId = -1;
let nextTabId = 1;

function activeTab(): Tab {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) throw new Error("활성 탭 없음");
  return tab;
}

function isDirty(tab: Tab): boolean {
  return tab.model.getAlternativeVersionId() !== tab.savedVersionId;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function tabLabel(tab: Tab): string {
  if (tab.path) return baseName(tab.path);
  if (tab.ftp) return `${baseName(tab.ftp.path)} (${tab.ftp.protocol.toUpperCase()})`;
  return "제목 없음";
}

function renderTabs() {
  tabbarEl.innerHTML = "";
  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTabId ? " active" : "");
    const label = document.createElement("span");
    label.textContent = (isDirty(tab) ? "● " : "") + tabLabel(tab);
    el.appendChild(label);
    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "✕";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      void closeTab(tab.id);
    });
    el.appendChild(close);
    el.addEventListener("click", () => switchTab(tab.id));
    tabbarEl.appendChild(el);
  }
}

function updateStatusAndTitle() {
  const tab = activeTab();
  const dirty = isDirty(tab) ? "● " : "";
  stPathEl.textContent =
    tab.path ?? (tab.ftp ? `${tab.ftp.protocol}://${tab.ftp.host}:${tab.ftp.port}${tab.ftp.path}` : "(저장되지 않음)");
  stLangEl.textContent = tab.model.getLanguageId();
  stTabEl.textContent = `탭: ${tabWidth}`;
  stEncodingEl.textContent = tab.encoding;
  void appWindow.setTitle(`${dirty}${tabLabel(tab)} — iDit`);
  renderTabs();
}

function updatePosStatus() {
  const pos = editor.getPosition();
  if (!pos) return;
  stPosEl.textContent = `줄 ${pos.lineNumber}, 열 ${pos.column}`;
}

function createTab(
  text: string,
  lang: string,
  opts?: { path?: string; ftp?: RemoteSource; encoding?: string },
): Tab {
  const id = nextTabId++;
  const model = monaco.editor.createModel(text, lang, monaco.Uri.parse(`inmemory://idit/${id}`));
  model.updateOptions({ tabSize: tabWidth });
  const tab: Tab = {
    id,
    model,
    path: opts?.path ?? null,
    ftp: opts?.ftp ?? null,
    encoding: opts?.encoding ?? "UTF-8",
    savedVersionId: model.getAlternativeVersionId(),
    viewState: null,
  };
  tabs.push(tab);
  switchTab(id);
  return tab;
}

function switchTab(id: number) {
  const current = tabs.find((t) => t.id === activeTabId);
  if (current) current.viewState = editor.saveViewState();

  const next = tabs.find((t) => t.id === id);
  if (!next) return;
  activeTabId = id;
  editor.setModel(next.model);
  if (next.viewState) editor.restoreViewState(next.viewState);
  editor.focus();
  updateStatusAndTitle();
  updatePosStatus();
}

async function confirmDiscard(tab: Tab): Promise<boolean> {
  if (!isDirty(tab)) return true;
  return ask(`"${tabLabel(tab)}"에 저장하지 않은 변경 사항이 있습니다. 닫으시겠습니까?`, {
    title: "iDit",
    kind: "warning",
  });
}

async function closeTab(id: number) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (!(await confirmDiscard(tab))) return;

  tabs.splice(idx, 1);
  tab.model.dispose();

  if (tabs.length === 0) {
    createTab("", "plaintext");
    return;
  }
  if (activeTabId === id) {
    const neighbor = tabs[Math.min(idx, tabs.length - 1)];
    switchTab(neighbor.id);
  } else {
    renderTabs();
  }
}

editor.onDidChangeModelContent(updateStatusAndTitle);
editor.onDidChangeCursorPosition(updatePosStatus);

// ---- 언어(문법 강조) 선택 — 상태바의 언어 표시 클릭 ----
const languageModal = document.getElementById("language-modal") as HTMLDivElement;
const languageFilter = document.getElementById("language-filter") as HTMLInputElement;
const languageListEl = document.getElementById("language-list") as HTMLDivElement;
const languageCancelBtn = document.getElementById("language-cancel") as HTMLButtonElement;

interface LangChoice {
  id: string;
  label: string;
}

function allLanguages(): LangChoice[] {
  const langs = monaco.languages.getLanguages().map((l) => ({
    id: l.id,
    label: (l.aliases && l.aliases[0]) || l.id,
  }));
  langs.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  return [{ id: "plaintext", label: "일반 텍스트 (Plain Text)" }, ...langs.filter((l) => l.id !== "plaintext")];
}

function openLanguagePicker() {
  const current = editor.getModel()?.getLanguageId() ?? "plaintext";
  const langs = allLanguages();

  const render = (filter: string) => {
    const f = filter.trim().toLowerCase();
    languageListEl.innerHTML = "";
    for (const lang of langs) {
      if (f && !lang.label.toLowerCase().includes(f) && !lang.id.toLowerCase().includes(f)) continue;
      const row = document.createElement("div");
      row.className = "language-item" + (lang.id === current ? " current" : "");
      row.textContent = lang.label;
      row.addEventListener("click", () => {
        monaco.editor.setModelLanguage(editor.getModel()!, lang.id);
        updateStatusAndTitle();
        close();
      });
      languageListEl.appendChild(row);
    }
  };

  const onFilter = () => render(languageFilter.value);
  const onCancel = () => close();
  function close() {
    languageFilter.removeEventListener("input", onFilter);
    languageCancelBtn.removeEventListener("click", onCancel);
    languageModal.classList.add("hidden");
  }

  languageFilter.value = "";
  render("");
  languageModal.classList.remove("hidden");
  languageFilter.focus();
  languageFilter.addEventListener("input", onFilter);
  languageCancelBtn.addEventListener("click", onCancel);
}

stLangEl.addEventListener("click", openLanguagePicker);

// ---- 탭(들여쓰기) 크기 — 상태바 클릭으로 2 → 4 → 8 순환 ----
stTabEl.addEventListener("click", () => {
  const steps = [2, 4, 8];
  tabWidth = steps[(steps.indexOf(tabWidth) + 1) % steps.length] ?? 2;
  localStorage.setItem("idit.tabSize", String(tabWidth));
  for (const t of tabs) t.model.updateOptions({ tabSize: tabWidth });
  editor.updateOptions({ tabSize: tabWidth });
  updateStatusAndTitle();
});

function newFile() {
  createTab("", "plaintext");
}

async function openFile() {
  const path = await openDialog({ multiple: false, directory: false });
  if (!path || Array.isArray(path)) return;
  const text = await readTextFile(path);
  createTab(text, languageFromPath(path), { path });
}

async function openFileWithEncoding() {
  const path = await openDialog({ multiple: false, directory: false });
  if (!path || Array.isArray(path)) return;
  const encoding = await pickEncoding("인코딩 지정해서 열기");
  if (!encoding) return;
  const bytes = await readFile(path);
  const text = await invoke<string>("decode_text", { bytes: Array.from(bytes), encoding });
  createTab(text, languageFromPath(path), { path, encoding });
}

async function openFromFtp() {
  const result = await ftpOpenFlow();
  if (!result) return;
  createTab(result.content, languageFromPath(result.path), {
    ftp: { protocol: result.protocol, host: result.host, port: result.port, path: result.path },
  });
}

function markSaved(tab: Tab) {
  tab.savedVersionId = tab.model.getAlternativeVersionId();
  updateStatusAndTitle();
}

async function writeWithEncoding(path: string, content: string, encoding: string): Promise<boolean> {
  if (encoding === "UTF-8") {
    await writeTextFile(path, content);
    return true;
  }
  const result = await invoke<{ bytes: number[]; had_errors: boolean }>("encode_text", { text: content, encoding });
  if (result.had_errors) {
    const proceed = await ask(
      `일부 문자는 ${encoding} 인코딩으로 표현할 수 없어 대체 문자(?)로 바뀝니다. 계속 저장하시겠습니까?`,
      { title: "iDit", kind: "warning" },
    );
    if (!proceed) return false;
  }
  await writeFile(path, new Uint8Array(result.bytes));
  return true;
}

async function saveLocal(forcePickPath: boolean) {
  const tab = activeTab();
  let path = tab.path;
  if (!path || forcePickPath) {
    const picked = await saveDialog();
    if (!picked) return;
    path = picked;
  }
  if (!(await writeWithEncoding(path, tab.model.getValue(), tab.encoding))) return;
  tab.path = path;
  tab.ftp = null;
  monaco.editor.setModelLanguage(tab.model, languageFromPath(path));
  markSaved(tab);
}

async function saveWithEncoding() {
  const tab = activeTab();
  const encoding = await pickEncoding("인코딩 지정해서 저장", tab.encoding);
  if (!encoding) return;
  let path = tab.path;
  if (!path) {
    const picked = await saveDialog();
    if (!picked) return;
    path = picked;
  }
  if (!(await writeWithEncoding(path, tab.model.getValue(), encoding))) return;
  tab.path = path;
  tab.ftp = null;
  tab.encoding = encoding;
  monaco.editor.setModelLanguage(tab.model, languageFromPath(path));
  markSaved(tab);
}

async function saveToFtp(forcePickPath: boolean) {
  const tab = activeTab();
  const content = tab.model.getValue();
  if (tab.ftp && !forcePickPath) {
    const ok = await ftpSaveTo(tab.ftp.protocol, tab.ftp.host, tab.ftp.port, tab.ftp.path, content);
    if (!ok) return;
    markSaved(tab);
    return;
  }
  const suggested = tab.path ? baseName(tab.path) : tab.ftp ? baseName(tab.ftp.path) : undefined;
  const result = await ftpSaveFlow(content, suggested);
  if (!result) return;
  tab.path = null;
  tab.ftp = { protocol: result.protocol, host: result.host, port: result.port, path: result.path };
  monaco.editor.setModelLanguage(tab.model, languageFromPath(result.path));
  markSaved(tab);
}

async function save() {
  const tab = activeTab();
  if (tab.ftp) {
    await saveToFtp(false);
  } else {
    await saveLocal(false);
  }
}

createTab("", "plaintext");

appWindow.onCloseRequested(async (event) => {
  if (!tabs.some(isDirty)) return;
  event.preventDefault();
  const discard = await ask("저장하지 않은 변경 사항이 있습니다. 저장하지 않고 닫으시겠습니까?", {
    title: "iDit",
    kind: "warning",
  });
  if (discard) await appWindow.destroy();
});

// ---- 뷰 상태 ----
let wordWrapOn = false;
let minimapOn = true;

function applyViewOptions() {
  editor.updateOptions({
    wordWrap: wordWrapOn ? "on" : "off",
    minimap: { enabled: minimapOn },
    fontSize,
    fontFamily,
  });
}

async function changeFont() {
  const result = await pickFont(fontFamily, fontSize);
  if (!result) return;
  fontFamily = result.family;
  fontSize = result.size;
  localStorage.setItem("idit.fontFamily", fontFamily);
  localStorage.setItem("idit.fontSize", String(fontSize));
  applyViewOptions();
}

// ---- 메뉴/단축키 동작 ----
// 메뉴 클릭(native menu → "menu" 이벤트)과 키보드 단축키 둘 다 이 함수로 들어온다.
// (Windows WebView2 환경에서 OS 메뉴 accelerator가 포커스 상태에 따라 씹히는
// 경우가 있어 — Ctrl+O 미동작 — 메뉴에는 accelerator를 등록하지 않고, 실제
// 단축키는 아래 keydown(capture) 핸들러에서 직접 처리한다.)
async function runAction(id: string) {
  switch (id) {
      case "file:new":
        newFile();
        break;
      case "file:open":
        await openFile();
        break;
      case "file:open_encoding":
        await openFileWithEncoding();
        break;
      case "file:open_ftp":
        await openFromFtp();
        break;
      case "file:save":
        await save();
        break;
      case "file:save_as":
        await saveLocal(true);
        break;
      case "file:save_encoding":
        await saveWithEncoding();
        break;
      case "file:save_ftp":
        await saveToFtp(true);
        break;
      case "file:exit":
        await appWindow.close();
        break;

      case "edit:undo":
        editor.focus();
        editor.trigger("menu", "undo", null);
        break;
      case "edit:redo":
        editor.focus();
        editor.trigger("menu", "redo", null);
        break;
      case "edit:cut":
        editor.focus();
        editor.getAction("editor.action.clipboardCutAction")?.run();
        break;
      case "edit:copy":
        editor.focus();
        editor.getAction("editor.action.clipboardCopyAction")?.run();
        break;
      case "edit:paste":
        editor.focus();
        editor.getAction("editor.action.clipboardPasteAction")?.run();
        break;
      case "edit:select_all":
        editor.focus();
        editor.setSelection(editor.getModel()!.getFullModelRange());
        break;
      case "edit:find":
        editor.focus();
        editor.getAction("actions.find")?.run();
        break;
      case "edit:replace":
        editor.focus();
        editor.getAction("editor.action.startFindReplaceAction")?.run();
        break;

      case "view:wordwrap":
        wordWrapOn = !wordWrapOn;
        applyViewOptions();
        break;
      case "view:minimap":
        minimapOn = !minimapOn;
        applyViewOptions();
        break;
      case "view:zoom_in":
        fontSize = Math.min(fontSize + 2, 40);
        applyViewOptions();
        break;
      case "view:zoom_out":
        fontSize = Math.max(fontSize - 2, 8);
        applyViewOptions();
        break;
      case "view:zoom_reset":
        fontSize = 14;
        applyViewOptions();
        break;
      case "view:font":
        await changeFont();
        break;

      case "help:about":
        await message("iDit — 코딩을 위한 가벼운 텍스트 에디터\n버전 0.1.0", {
          title: "iDit 정보",
          kind: "info",
        });
        break;
  }
}

// 커스텀 인앱 메뉴바 — 메뉴 항목 클릭은 runAction으로 들어온다.
const menuBar = initMenuBar((id) => void runAction(id));

function modalOpen(): HTMLElement | null {
  return document.querySelector(".modal:not(.hidden)");
}

// ESC — 열려 있는 팝업을 닫는다 (해당 모달의 취소/닫기 버튼을 눌러 정상적으로 정리한다).
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    const modal = modalOpen();
    if (!modal) return;
    const dismiss = modal.querySelector(".modal-dismiss") as HTMLButtonElement | null;
    if (dismiss) {
      e.preventDefault();
      e.stopPropagation();
      dismiss.click();
    }
  },
  true,
);

// Alt를 조합키 없이 혼자 눌렀다 뗄 때만 파일 메뉴를 연다 (Alt+F 등 조합과는 구분).
let altUsedAsCombo = false;
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Alt") return;
    if (e.altKey) altUsedAsCombo = true;
  },
  true,
);
window.addEventListener(
  "keyup",
  (e) => {
    if (e.key !== "Alt") return;
    if (!altUsedAsCombo && !modalOpen()) {
      e.preventDefault();
      menuBar.openFileMenu();
    }
    altUsedAsCombo = false;
  },
  true,
);

// capture 단계에서 가로채 Monaco/웹뷰 기본 동작보다 먼저 처리한다.
window.addEventListener(
  "keydown",
  (e) => {
    if (modalOpen()) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      void runAction("file:open_ftp");
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    let id: string | null = null;
    if (key === "n") id = "file:new";
    else if (key === "o") id = "file:open";
    else if (key === "s") id = e.shiftKey ? "file:save_as" : "file:save";
    else if (key === "=" || key === "+") id = "view:zoom_in";
    else if (key === "-") id = "view:zoom_out";
    else if (key === "0") id = "view:zoom_reset";
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    void runAction(id);
  },
  true,
);
