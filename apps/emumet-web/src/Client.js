export const initThemeSelector = () => {
  const d = document.documentElement;

  document.addEventListener("click", (e) => {
    const colorBtn = e.target.closest("[data-color-option]");
    if (colorBtn) {
      const color = colorBtn.getAttribute("data-color-option");
      d.setAttribute("data-color", color);
      localStorage.setItem("ratcap-color", color);
      const bg = { purple: "#241434", navy: "#1a2540" };
      d.style.backgroundColor = bg[color] || bg.purple;
    }

    const shapeBtn = e.target.closest("[data-shape-option]");
    if (shapeBtn) {
      const shape = shapeBtn.getAttribute("data-shape-option");
      d.setAttribute("data-shape", shape);
      localStorage.setItem("ratcap-shape", shape);
    }
  });
};

// Flame の document keydown 購読はイベントそのものを渡すので、押されたキーだけを取り出す
export const eventKey = (event) => (typeof event.key === "string" ? event.key : "");
