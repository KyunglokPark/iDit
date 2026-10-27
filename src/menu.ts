// 커스텀 인앱 메뉴바 (iDrop/iDOT와 같은 패턴 — 창 안 상단 스트립에 로고 + 메뉴).
// 네이티브 OS 메뉴 대신 이걸 쓴다. 각 항목 클릭은 runAction(id)로 넘긴다.

interface MenuItem {
  id?: string;
  label?: string;
  accel?: string;
  sep?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

const MENUS: MenuDef[] = [
  {
    label: "파일",
    items: [
      { id: "file:new", label: "새 파일", accel: "Ctrl+N" },
      { id: "file:open", label: "열기...", accel: "Ctrl+O" },
      { id: "file:open_encoding", label: "인코딩 지정해서 열기..." },
      { id: "file:open_ftp", label: "원격에서 열기(FTP/SFTP)...", accel: "Alt+F" },
      { sep: true },
      { id: "file:save", label: "저장", accel: "Ctrl+S" },
      { id: "file:save_as", label: "다른 이름으로 저장...", accel: "Ctrl+Shift+S" },
      { id: "file:save_encoding", label: "인코딩 지정해서 저장..." },
      { id: "file:save_ftp", label: "원격으로 저장(FTP/SFTP)..." },
      { sep: true },
      { id: "file:exit", label: "종료" },
    ],
  },
  {
    label: "편집",
    items: [
      { id: "edit:undo", label: "실행 취소", accel: "Ctrl+Z" },
      { id: "edit:redo", label: "다시 실행", accel: "Ctrl+Y" },
      { sep: true },
      { id: "edit:cut", label: "잘라내기", accel: "Ctrl+X" },
      { id: "edit:copy", label: "복사", accel: "Ctrl+C" },
      { id: "edit:paste", label: "붙여넣기", accel: "Ctrl+V" },
      { id: "edit:select_all", label: "모두 선택", accel: "Ctrl+A" },
      { sep: true },
      { id: "edit:find", label: "찾기...", accel: "Ctrl+F" },
      { id: "edit:replace", label: "바꾸기...", accel: "Ctrl+H" },
    ],
  },
  {
    label: "보기",
    items: [
      { id: "view:wordwrap", label: "자동 줄바꿈 전환" },
      { id: "view:minimap", label: "미니맵 전환" },
      { sep: true },
      { id: "view:zoom_in", label: "확대", accel: "Ctrl+=" },
      { id: "view:zoom_out", label: "축소", accel: "Ctrl+-" },
      { id: "view:zoom_reset", label: "확대/축소 초기화", accel: "Ctrl+0" },
      { sep: true },
      { id: "view:font", label: "글꼴 변경..." },
    ],
  },
  {
    label: "도움말",
    items: [{ id: "help:about", label: "iDit 정보" }],
  },
];

let openMenuEl: HTMLDivElement | null = null;

function closeMenu() {
  if (openMenuEl) {
    openMenuEl.classList.remove("open");
    openMenuEl = null;
  }
}

function openMenu(el: HTMLDivElement) {
  if (openMenuEl && openMenuEl !== el) openMenuEl.classList.remove("open");
  el.classList.add("open");
  openMenuEl = el;
}

/** 메뉴바를 그린다. 반환된 openFileMenu()는 Alt 키로 파일 메뉴를 열 때 쓴다. */
export function initMenuBar(runAction: (id: string) => void): { openFileMenu: () => void } {
  const bar = document.getElementById("menubar") as HTMLDivElement;
  bar.innerHTML = "";

  const logo = document.createElement("img");
  logo.className = "app-logo";
  logo.src = "/logo.png";
  logo.alt = "iDit";
  bar.appendChild(logo);

  const name = document.createElement("span");
  name.className = "app-name";
  name.textContent = "iDit";
  bar.appendChild(name);

  const menuEls: HTMLDivElement[] = [];
  for (const def of MENUS) {
    const menu = document.createElement("div");
    menu.className = "menu";

    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = def.label;
    menu.appendChild(label);

    const drop = document.createElement("div");
    drop.className = "menu-drop";
    for (const item of def.items) {
      if (item.sep) {
        const sep = document.createElement("div");
        sep.className = "menu-sep";
        drop.appendChild(sep);
        continue;
      }
      const row = document.createElement("div");
      row.className = "menu-item";
      const text = document.createElement("span");
      text.textContent = item.label ?? "";
      row.appendChild(text);
      if (item.accel) {
        const accel = document.createElement("span");
        accel.className = "accel";
        accel.textContent = item.accel;
        row.appendChild(accel);
      }
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        if (item.id) runAction(item.id);
      });
      drop.appendChild(row);
    }
    menu.appendChild(drop);

    // 클릭으로 열고 닫기, 다른 메뉴가 열려 있을 땐 호버로 전환 (실제 메뉴바처럼)
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.classList.contains("open")) closeMenu();
      else openMenu(menu);
    });
    label.addEventListener("mouseenter", () => {
      if (openMenuEl && openMenuEl !== menu) openMenu(menu);
    });

    bar.appendChild(menu);
    menuEls.push(menu);
  }

  // 바깥 클릭 시 닫기
  document.addEventListener("click", () => closeMenu());

  return {
    openFileMenu: () => {
      if (openMenuEl === menuEls[0]) closeMenu();
      else openMenu(menuEls[0]);
    },
  };
}
