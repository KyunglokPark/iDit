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
      { sep: true },
      { id: "edit:column", label: "칼럼 선택 모드 전환", accel: "Ctrl+Alt+C" },
    ],
  },
  {
    label: "도구",
    items: [
      { id: "tool:macro_record", label: "매크로 기록 시작/중지", accel: "Ctrl+Shift+R" },
      { id: "tool:macro_play", label: "매크로 재생", accel: "Ctrl+Shift+P" },
      { sep: true },
      { id: "tool:hex_current", label: "현재 파일 HEX로 보기" },
      { id: "tool:hex", label: "HEX로 열기..." },
      { id: "tool:diff", label: "파일 비교(diff)..." },
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

const menuEls: HTMLDivElement[] = [];
const itemEls: HTMLDivElement[][] = []; // 메뉴별 클릭 가능한 항목(구분선 제외)
let openIdx = -1; // 열린 상단 메뉴 인덱스
let itemIdx = -1; // 그 안에서 키보드로 하이라이트된 항목

function clearHighlight() {
  if (openIdx >= 0) itemEls[openIdx].forEach((el) => el.classList.remove("active"));
}

function closeMenu() {
  clearHighlight();
  if (openIdx >= 0) menuEls[openIdx].classList.remove("open");
  openIdx = -1;
  itemIdx = -1;
}

function openMenu(idx: number) {
  if (openIdx === idx) return;
  closeMenu();
  menuEls[idx].classList.add("open");
  openIdx = idx;
  itemIdx = -1;
}

function highlight(idx: number) {
  clearHighlight();
  const items = itemEls[openIdx];
  if (!items.length) return;
  itemIdx = (idx + items.length) % items.length;
  items[itemIdx].classList.add("active");
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

  MENUS.forEach((def, mi) => {
    const menu = document.createElement("div");
    menu.className = "menu";

    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = def.label;
    menu.appendChild(label);

    const drop = document.createElement("div");
    drop.className = "menu-drop";
    const items: HTMLDivElement[] = [];
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
      items.push(row);
    }
    menu.appendChild(drop);

    label.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openIdx === mi) closeMenu();
      else openMenu(mi);
    });
    label.addEventListener("mouseenter", () => {
      if (openIdx >= 0 && openIdx !== mi) openMenu(mi);
    });

    bar.appendChild(menu);
    menuEls.push(menu);
    itemEls.push(items);
  });

  // 바깥 클릭 시 닫기
  document.addEventListener("click", () => closeMenu());

  // 키보드 네비게이션 (메뉴가 열려 있을 때만)
  document.addEventListener(
    "keydown",
    (e) => {
      if (openIdx < 0) return;
      const nav = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Enter", "Escape"];
      if (!nav.includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation(); // 에디터로 방향키/엔터가 새어나가지 않게
      switch (e.key) {
        case "ArrowRight":
          openMenu((openIdx + 1) % menuEls.length);
          highlight(0);
          break;
        case "ArrowLeft":
          openMenu((openIdx - 1 + menuEls.length) % menuEls.length);
          highlight(0);
          break;
        case "ArrowDown":
          highlight(itemIdx + 1);
          break;
        case "ArrowUp":
          highlight(itemIdx - 1);
          break;
        case "Enter":
          if (itemIdx >= 0) itemEls[openIdx][itemIdx].click();
          break;
        case "Escape":
          closeMenu();
          break;
      }
    },
    true,
  );

  return {
    openFileMenu: () => {
      if (openIdx === 0) closeMenu();
      else {
        openMenu(0);
        highlight(0); // Alt로 열면 첫 항목을 바로 하이라이트
      }
    },
  };
}
