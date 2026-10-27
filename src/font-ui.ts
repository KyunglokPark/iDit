const modal = document.getElementById("font-modal") as HTMLDivElement;
const familySelect = document.getElementById("font-family") as HTMLSelectElement;
const sizeValueEl = document.getElementById("font-size-value") as HTMLSpanElement;
const sizeDecBtn = document.getElementById("font-size-dec") as HTMLButtonElement;
const sizeIncBtn = document.getElementById("font-size-inc") as HTMLButtonElement;
const okBtn = document.getElementById("font-ok") as HTMLButtonElement;
const cancelBtn = document.getElementById("font-cancel") as HTMLButtonElement;

const MIN_SIZE = 8;
const MAX_SIZE = 40;

export async function pickFont(currentFamily: string, currentSize: number): Promise<{ family: string; size: number } | null> {
  return new Promise((resolve) => {
    const hasOption = Array.from(familySelect.options).some((o) => o.value === currentFamily);
    familySelect.value = hasOption ? currentFamily : familySelect.options[0].value;
    let size = currentSize;
    sizeValueEl.textContent = `${size}px`;
    modal.classList.remove("hidden");

    const cleanup = () => {
      sizeDecBtn.removeEventListener("click", onDec);
      sizeIncBtn.removeEventListener("click", onInc);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.classList.add("hidden");
    };
    const onDec = () => {
      size = Math.max(MIN_SIZE, size - 1);
      sizeValueEl.textContent = `${size}px`;
    };
    const onInc = () => {
      size = Math.min(MAX_SIZE, size + 1);
      sizeValueEl.textContent = `${size}px`;
    };
    const onOk = () => {
      const family = familySelect.value;
      cleanup();
      resolve({ family, size });
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    sizeDecBtn.addEventListener("click", onDec);
    sizeIncBtn.addEventListener("click", onInc);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}
