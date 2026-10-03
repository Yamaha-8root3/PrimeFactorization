export const $ = (id: string) => document.getElementById(id)!;
export const press = (el: Element, fn: () => void) =>
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fn();
  });
