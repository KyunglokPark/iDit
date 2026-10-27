// 원격 열기/저장 통합 창 — 왼쪽에 저장된 사이트 목록, 오른쪽에 파일 탐색기.
// 사이트를 고르면 그 자리에서 연결하고 오른쪽에 파일이 뜬다(창 전환 없음).
// 파일 목록은 이름/크기/수정일 컬럼 + 정렬, 사이트별 마지막 경로를 기억한다.
import { invoke } from "@tauri-apps/api/core";
import { openSiteForm } from "./ftp-sites-ui";
import {
  FtpSite,
  addGroup,
  deleteGroup,
  deleteSite,
  listGroups,
  listSites,
  setSiteLastDir,
} from "./ftp-sites";

export type RemoteProtocol = "ftp" | "sftp";

interface RemoteEntry {
  name: string;
  is_dir: boolean;
  size: number;
  mtime: number;
  modified: string;
}

export interface FtpOpenResult {
  protocol: RemoteProtocol;
  host: string;
  port: number;
  path: string;
  content: string;
}

export interface FtpSaveResult {
  protocol: RemoteProtocol;
  host: string;
  port: number;
  path: string;
}

type Conn = { protocol: RemoteProtocol; host: string; port: number; siteId: string };
let connected: Conn | null = null;

function cmd(protocol: RemoteProtocol, name: string): string {
  return `${protocol}_${name}`;
}

const modal = document.getElementById("remote-modal") as HTMLDivElement;
const titleEl = document.getElementById("remote-title") as HTMLHeadingElement;
const siteListEl = document.getElementById("remote-site-list") as HTMLDivElement;
const siteNewBtn = document.getElementById("remote-site-new") as HTMLButtonElement;
const siteEditBtn = document.getElementById("remote-site-edit") as HTMLButtonElement;
const siteDelBtn = document.getElementById("remote-site-del") as HTMLButtonElement;
const siteGroupBtn = document.getElementById("remote-site-group") as HTMLButtonElement;
const upBtn = document.getElementById("remote-up") as HTMLButtonElement;
const pathInput = document.getElementById("remote-path") as HTMLInputElement;
const goBtn = document.getElementById("remote-go") as HTMLButtonElement;
const listEl = document.getElementById("remote-list") as HTMLDivElement;
const headEl = document.querySelector(".remote-list-head") as HTMLDivElement;
const saveRow = document.getElementById("remote-save-row") as HTMLDivElement;
const filenameInput = document.getElementById("remote-filename") as HTMLInputElement;
const statusEl = document.getElementById("remote-status") as HTMLDivElement;
const errorEl = document.getElementById("remote-error") as HTMLDivElement;
const okBtn = document.getElementById("remote-ok") as HTMLButtonElement;
const cancelBtn = document.getElementById("remote-cancel") as HTMLButtonElement;

function joinPath(dir: string, name: string): string {
  if (dir === "/" || dir === "") return `/${name}`;
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

function parentPath(dir: string): string {
  if (dir === "/" || dir === "") return "/";
  const trimmed = dir.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(entry: RemoteEntry): string {
  if (entry.mtime > 0) {
    const d = new Date(entry.mtime * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return entry.modified || "";
}

// ---- 연결 -------------------------------------------------------------------

async function disconnectCurrent() {
  if (!connected) return;
  try {
    await invoke(cmd(connected.protocol, "disconnect"));
  } catch {
    /* 무시 */
  }
  connected = null;
}

async function connectSite(site: FtpSite): Promise<boolean> {
  if (
    connected &&
    connected.protocol === site.protocol &&
    connected.host === site.host &&
    connected.port === site.port
  ) {
    return true; // 이미 이 사이트에 연결됨
  }
  await disconnectCurrent();
  statusEl.textContent = `${site.host} 연결 중...`;
  errorEl.textContent = "";
  try {
    await invoke(cmd(site.protocol, "connect"), {
      host: site.host,
      port: site.port,
      user: site.username,
      pass: site.password,
    });
    connected = { protocol: site.protocol, host: site.host, port: site.port, siteId: site.id };
    statusEl.textContent = `${site.host} 연결됨`;
    return true;
  } catch (e) {
    statusEl.textContent = "";
    errorEl.textContent = String(e);
    return false;
  }
}

// ---- 파일 탐색 --------------------------------------------------------------

let entries: RemoteEntry[] = [];
let currentDir = "/";
let selectedName: string | null = null;
let sortKey: "name" | "size" | "date" = "name";
let sortAsc = true;

function sortEntries() {
  entries.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1; // 폴더 먼저
    let c = 0;
    if (sortKey === "name") c = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    else if (sortKey === "size") c = a.size - b.size;
    else c = a.mtime - b.mtime || a.modified.localeCompare(b.modified);
    return sortAsc ? c : -c;
  });
}

function renderList(mode: "open" | "save") {
  sortEntries();
  listEl.innerHTML = "";
  selectedName = null;
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "remote-row";
    row.dataset.name = entry.name;

    const name = document.createElement("span");
    name.className = "col-name";
    name.textContent = `${entry.is_dir ? "📁" : "📄"} ${entry.name}`;
    const size = document.createElement("span");
    size.className = "col-size";
    size.textContent = entry.is_dir ? "" : formatSize(entry.size);
    const date = document.createElement("span");
    date.className = "col-date";
    date.textContent = formatDate(entry);
    row.append(name, size, date);

    row.addEventListener("click", () => {
      if (entry.is_dir) return;
      listEl.querySelectorAll(".remote-row.selected").forEach((el) => el.classList.remove("selected"));
      row.classList.add("selected");
      selectedName = entry.name;
      if (mode === "save") filenameInput.value = entry.name;
    });
    row.addEventListener("dblclick", () => {
      if (entry.is_dir) {
        void navigate(joinPath(currentDir, entry.name), mode);
      } else if (mode === "open") {
        selectedName = entry.name;
        okBtn.click();
      }
    });
    listEl.appendChild(row);
  }
}

async function navigate(dir: string, mode: "open" | "save") {
  if (!connected) return;
  statusEl.textContent = "불러오는 중...";
  try {
    const result = await invoke<RemoteEntry[]>(cmd(connected.protocol, "list"), { path: dir });
    entries = result;
    currentDir = dir;
    pathInput.value = dir;
    renderList(mode);
    statusEl.textContent = `${connected.host}${dir}`;
    errorEl.textContent = "";
    setSiteLastDir(connected.siteId, dir);
  } catch (e) {
    statusEl.textContent = "";
    errorEl.textContent = String(e);
  }
}

// ---- 사이트 목록 ------------------------------------------------------------

let selectedSiteId: string | null = null;

async function renderSites() {
  const [sites, groups] = await Promise.all([listSites(), listGroups()]);
  siteListEl.innerHTML = "";
  const buckets = ["", ...groups];
  for (const g of buckets) {
    const inGroup = sites.filter((s) => s.group === g);
    if (g === "" && inGroup.length === 0) continue;
    const groupRow = document.createElement("div");
    groupRow.className = "site-group-row";
    const label = document.createElement("span");
    label.textContent = g || "(그룹 없음)";
    groupRow.appendChild(label);
    if (g) {
      const del = document.createElement("span");
      del.className = "group-del";
      del.textContent = "✕";
      del.title = "그룹 삭제";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteGroup(g);
        void renderSites();
      });
      groupRow.appendChild(del);
    }
    siteListEl.appendChild(groupRow);

    for (const site of inGroup) {
      const row = document.createElement("div");
      row.className = "site-row" + (site.id === selectedSiteId ? " selected" : "");
      row.dataset.id = site.id;
      row.textContent = `${site.protocol.toUpperCase()} · ${site.name}`;
      row.addEventListener("click", () => {
        selectedSiteId = site.id;
        siteListEl.querySelectorAll(".site-row.selected").forEach((el) => el.classList.remove("selected"));
        row.classList.add("selected");
      });
      row.addEventListener("dblclick", () => void chooseSite(site));
      siteListEl.appendChild(row);
    }
  }
}

function selectedSite(sites: FtpSite[]): FtpSite | undefined {
  return sites.find((s) => s.id === selectedSiteId);
}

let currentMode: "open" | "save" = "open";

async function chooseSite(site: FtpSite) {
  selectedSiteId = site.id;
  if (!(await connectSite(site))) return;
  await navigate(site.lastDir || (await pwd()), currentMode);
}

async function pwd(): Promise<string> {
  if (!connected) return "/";
  try {
    return (await invoke<string>(cmd(connected.protocol, "pwd"))) || "/";
  } catch {
    return "/";
  }
}

// ---- 창 전체 ----------------------------------------------------------------

function openRemote(mode: "open" | "save", suggestedName?: string): Promise<FtpSaveResult | null> {
  currentMode = mode;
  titleEl.textContent = mode === "open" ? "원격에서 열기" : "원격으로 저장";
  okBtn.textContent = mode === "open" ? "열기" : "저장";
  saveRow.classList.toggle("hidden", mode !== "save");
  filenameInput.value = suggestedName ?? "";
  errorEl.textContent = "";
  statusEl.textContent = "사이트를 선택하세요.";
  entries = [];
  listEl.innerHTML = "";
  pathInput.value = "";

  return new Promise((resolve) => {
    void renderSites();

    // 이미 연결돼 있으면 그 사이트를 자동 선택하고 마지막 폴더를 연다.
    if (connected) {
      selectedSiteId = connected.siteId;
      void navigate(currentDir || "/", mode);
    }

    const onSiteNew = () =>
      void (async () => {
        const site = await openSiteForm();
        if (site) {
          selectedSiteId = site.id;
          await renderSites();
        }
      })();
    const onSiteEdit = () =>
      void (async () => {
        const site = selectedSite(await listSites());
        if (!site) return;
        const edited = await openSiteForm(site);
        if (edited) await renderSites();
      })();
    const onSiteDel = () =>
      void (async () => {
        const site = selectedSite(await listSites());
        if (!site) return;
        deleteSite(site.id);
        if (selectedSiteId === site.id) selectedSiteId = null;
        await renderSites();
      })();
    const onSiteGroup = () => {
      const name = prompt("새 그룹 이름");
      if (name && name.trim()) {
        addGroup(name.trim());
        void renderSites();
      }
    };
    const onUp = () => void navigate(parentPath(currentDir), mode);
    const onGo = () => void navigate(pathInput.value.trim() || "/", mode);
    const onHeadClick = (e: MouseEvent) => {
      const key = (e.target as HTMLElement).dataset.sort as "name" | "size" | "date" | undefined;
      if (!key) return;
      if (sortKey === key) sortAsc = !sortAsc;
      else {
        sortKey = key;
        sortAsc = true;
      }
      renderList(mode);
    };

    const cleanup = () => {
      siteNewBtn.removeEventListener("click", onSiteNew);
      siteEditBtn.removeEventListener("click", onSiteEdit);
      siteDelBtn.removeEventListener("click", onSiteDel);
      siteGroupBtn.removeEventListener("click", onSiteGroup);
      upBtn.removeEventListener("click", onUp);
      goBtn.removeEventListener("click", onGo);
      headEl.removeEventListener("click", onHeadClick);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.classList.add("hidden");
    };
    const onOk = () => {
      if (!connected) {
        errorEl.textContent = "사이트에 연결하세요.";
        return;
      }
      let name: string | null;
      if (mode === "open") {
        name = selectedName;
        if (!name) {
          errorEl.textContent = "파일을 선택하세요.";
          return;
        }
      } else {
        name = filenameInput.value.trim();
        if (!name) {
          errorEl.textContent = "파일명을 입력하세요.";
          return;
        }
      }
      const path = joinPath(currentDir, name);
      const out: FtpSaveResult = {
        protocol: connected.protocol,
        host: connected.host,
        port: connected.port,
        path,
      };
      cleanup();
      resolve(out);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    siteNewBtn.addEventListener("click", onSiteNew);
    siteEditBtn.addEventListener("click", onSiteEdit);
    siteDelBtn.addEventListener("click", onSiteDel);
    siteGroupBtn.addEventListener("click", onSiteGroup);
    upBtn.addEventListener("click", onUp);
    goBtn.addEventListener("click", onGo);
    headEl.addEventListener("click", onHeadClick);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);

    modal.classList.remove("hidden");
  });
}

// ---- 외부 API (main.ts에서 호출) --------------------------------------------

export async function ftpOpenFlow(): Promise<FtpOpenResult | null> {
  const picked = await openRemote("open");
  if (!picked || !connected) return null;
  try {
    const content = await invoke<string>(cmd(picked.protocol, "read_file"), { path: picked.path });
    return { ...picked, content };
  } catch (e) {
    alert(String(e));
    return null;
  }
}

export async function ftpSaveFlow(content: string, suggestedName?: string): Promise<FtpSaveResult | null> {
  const picked = await openRemote("save", suggestedName);
  if (!picked) return null;
  try {
    await invoke(cmd(picked.protocol, "write_file"), { path: picked.path, content });
    return picked;
  } catch (e) {
    alert(String(e));
    return null;
  }
}

export async function ftpSaveTo(
  protocol: RemoteProtocol,
  host: string,
  port: number,
  path: string,
  content: string,
): Promise<boolean> {
  // 같은 원격에 아직 연결돼 있으면 조용히 덮어쓴다.
  if (connected && connected.protocol === protocol && connected.host === host && connected.port === port) {
    try {
      await invoke(cmd(protocol, "write_file"), { path, content });
      return true;
    } catch (e) {
      alert(String(e));
      connected = null;
      return false;
    }
  }
  // 연결이 끊겼으면 통합 창에서 다시 사이트를 골라 저장한다 (파일명은 기존 이름 기본값).
  const base = path.split("/").pop() || "";
  const result = await ftpSaveFlow(content, base);
  return result !== null;
}
