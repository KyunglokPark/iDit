const modal = document.getElementById("encoding-modal") as HTMLDivElement;
const titleEl = document.getElementById("encoding-title") as HTMLHeadingElement;
const selectEl = document.getElementById("encoding-select") as HTMLSelectElement;
const errorEl = document.getElementById("encoding-error") as HTMLDivElement;
const okBtn = document.getElementById("encoding-ok") as HTMLButtonElement;
const cancelBtn = document.getElementById("encoding-cancel") as HTMLButtonElement;

export async function pickEncoding(title: string, current = "UTF-8"): Promise<string | null> {
  return new Promise((resolve) => {
    titleEl.textContent = title;
    errorEl.textContent = "";
    selectEl.value = current;
    modal.classList.remove("hidden");

    const cleanup = () => {
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.classList.add("hidden");
    };
    const onOk = () => {
      cleanup();
      resolve(selectEl.value);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}
