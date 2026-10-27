// FTP 사이트 관리자 — 그룹/사이트를 로컬에 저장해두고 다시 꺼내 쓴다.
// 비밀번호는 Windows DPAPI 암호문("dpapi:…")으로 저장한다 (secret_protect/unprotect,
// iDrop과 같은 방식). 메모리에서는 평문으로 들고 있다가 저장 직전에만 암호화한다.
import { invoke } from "@tauri-apps/api/core";

export interface FtpSite {
  id: string;
  name: string;
  group: string;
  protocol: "ftp" | "sftp";
  host: string;
  port: number;
  username: string;
  password: string;
  /** 마지막으로 머문 원격 디렉터리 (다음 접속 시 여기부터 탐색) */
  lastDir?: string;
}

const STORE_KEY = "idit.ftpSites";
const GROUPS_KEY = "idit.ftpGroups";
const SECRET_PREFIX = "dpapi:";

const secretCache = new Map<string, string>(); // 평문 → 암호문 (재암호화 방지)
let sites: FtpSite[] = [];
let groups: string[] = [];
let initialized = false;
let saveChain: Promise<void> = Promise.resolve();

function genId(): string {
  return crypto.randomUUID();
}

function normalize(x: unknown): FtpSite | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.host !== "string" || !o.host) return null;
  return {
    id: typeof o.id === "string" ? o.id : genId(),
    name: typeof o.name === "string" && o.name ? o.name : o.host,
    group: typeof o.group === "string" ? o.group : "",
    protocol: o.protocol === "sftp" ? "sftp" : "ftp",
    host: o.host,
    port: typeof o.port === "number" ? o.port : parseInt(String(o.port), 10) || 21,
    username: typeof o.username === "string" ? o.username : "",
    password: typeof o.password === "string" ? o.password : "",
    lastDir: typeof o.lastDir === "string" ? o.lastDir : undefined,
  };
}

function loadAll() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) sites = list.map(normalize).filter((s): s is FtpSite => s !== null);
  } catch {
    sites = [];
  }
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) groups = arr.filter((x): x is string => typeof x === "string");
  } catch {
    groups = [];
  }
}

function saveGroups() {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

function persistSites() {
  const snapshot = sites.map((s) => ({ ...s }));
  saveChain = saveChain
    .then(async () => {
      const need = [
        ...new Set(
          snapshot.map((s) => s.password).filter((p) => p && !p.startsWith(SECRET_PREFIX) && !secretCache.has(p)),
        ),
      ];
      if (need.length) {
        try {
          const enc = await invoke<string[]>("secret_protect", { values: need });
          need.forEach((p, i) => secretCache.set(p, enc[i]));
        } catch {
          need.forEach((p) => secretCache.set(p, p)); // 암호화 불가 환경 — 평문 유지
        }
      }
      const stored = snapshot.map((s) => ({
        ...s,
        password:
          s.password && !s.password.startsWith(SECRET_PREFIX) ? (secretCache.get(s.password) ?? s.password) : s.password,
      }));
      localStorage.setItem(STORE_KEY, JSON.stringify(stored));
    })
    .catch(() => {});
}

async function revealPasswords() {
  const enc = [...new Set(sites.map((s) => s.password).filter((p) => p.startsWith(SECRET_PREFIX)))];
  if (!enc.length) return;
  try {
    const plain = await invoke<string[]>("secret_unprotect", { values: enc });
    const map = new Map(enc.map((c, i) => [c, plain[i]]));
    enc.forEach((c, i) => plain[i] && secretCache.set(plain[i], c));
    sites = sites.map((s) => (s.password.startsWith(SECRET_PREFIX) ? { ...s, password: map.get(s.password) || "" } : s));
  } catch {
    /* Tauri 밖(브라우저 미리보기 등) — 그냥 둔다 */
  }
}

async function ensureInit() {
  if (initialized) return;
  initialized = true;
  loadAll();
  await revealPasswords();
}

export async function listSites(): Promise<FtpSite[]> {
  await ensureInit();
  return sites;
}

export async function listGroups(): Promise<string[]> {
  await ensureInit();
  return groups;
}

export function upsertSite(site: FtpSite) {
  const idx = sites.findIndex((s) => s.id === site.id);
  if (idx === -1) sites.push(site);
  else sites[idx] = site;
  persistSites();
}

export function deleteSite(id: string) {
  sites = sites.filter((s) => s.id !== id);
  persistSites();
}

/** 사이트의 마지막 탐색 경로를 기록한다 (다음 접속 때 이 폴더부터 연다). */
export function setSiteLastDir(id: string, dir: string) {
  const s = sites.find((x) => x.id === id);
  if (!s || s.lastDir === dir) return;
  s.lastDir = dir;
  persistSites();
}

export function addGroup(name: string) {
  if (name && !groups.includes(name)) {
    groups.push(name);
    saveGroups();
  }
}

export function deleteGroup(name: string) {
  groups = groups.filter((g) => g !== name);
  sites.forEach((s) => {
    if (s.group === name) s.group = "";
  });
  saveGroups();
  persistSites();
}
