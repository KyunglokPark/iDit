// 사이트 편집 서브다이얼로그 — 새 사이트 추가/기존 사이트 편집 폼.
// (목록 선택·탐색은 통합 창(ftp-ui.ts)에서 하고, 여기선 상세 입력만 담당한다.)
import { FtpSite, listGroups, upsertSite } from "./ftp-sites";

const modal = document.getElementById("site-form-modal") as HTMLDivElement;
const titleEl = document.getElementById("site-form-title") as HTMLHeadingElement;
const nameInput = document.getElementById("site-name") as HTMLInputElement;
const groupSelect = document.getElementById("site-group") as HTMLSelectElement;
const protocolSelect = document.getElementById("site-protocol") as HTMLSelectElement;
const hostInput = document.getElementById("site-host") as HTMLInputElement;
const portInput = document.getElementById("site-port") as HTMLInputElement;
const userInput = document.getElementById("site-user") as HTMLInputElement;
const passInput = document.getElementById("site-pass") as HTMLInputElement;
const errorEl = document.getElementById("site-form-error") as HTMLDivElement;
const saveBtn = document.getElementById("site-form-save") as HTMLButtonElement;
const cancelBtn = document.getElementById("site-form-cancel") as HTMLButtonElement;

protocolSelect.addEventListener("change", () => {
  // 포트가 기본값이면 프로토콜 기본 포트로 맞춘다
  if (portInput.value === "21" || portInput.value === "22" || !portInput.value) {
    portInput.value = protocolSelect.value === "sftp" ? "22" : "21";
  }
});

/** 사이트 편집 폼을 연다. existing 없으면 새 사이트, 있으면 편집. 저장하면 사이트 반환. */
export async function openSiteForm(existing?: FtpSite, defaultGroup = ""): Promise<FtpSite | null> {
  const groups = await listGroups();
  groupSelect.innerHTML = '<option value="">(그룹 없음)</option>';
  for (const g of groups) {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    groupSelect.appendChild(opt);
  }

  titleEl.textContent = existing ? "사이트 편집" : "새 사이트";
  nameInput.value = existing?.name ?? "";
  groupSelect.value = existing?.group ?? defaultGroup;
  protocolSelect.value = existing?.protocol ?? "ftp";
  hostInput.value = existing?.host ?? "";
  portInput.value = String(existing?.port ?? 21);
  userInput.value = existing?.username ?? "";
  passInput.value = existing?.password ?? "";
  errorEl.textContent = "";

  return new Promise((resolve) => {
    modal.classList.remove("hidden");
    nameInput.focus();

    const cleanup = () => {
      saveBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      modal.classList.add("hidden");
    };
    const onSave = () => {
      const host = hostInput.value.trim();
      if (!host) {
        errorEl.textContent = "호스트를 입력하세요.";
        return;
      }
      const protocol = protocolSelect.value === "sftp" ? "sftp" : "ftp";
      const site: FtpSite = {
        id: existing?.id ?? crypto.randomUUID(),
        name: nameInput.value.trim() || host,
        group: groupSelect.value,
        protocol,
        host,
        port: parseInt(portInput.value, 10) || (protocol === "sftp" ? 22 : 21),
        username: userInput.value,
        password: passInput.value,
        lastDir: existing?.lastDir,
      };
      upsertSite(site);
      cleanup();
      resolve(site);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    saveBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
  });
}
