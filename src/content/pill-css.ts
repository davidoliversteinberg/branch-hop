/**
 * Styles for the page pill. It lives inside a closed shadow root on someone else's page,
 * so it carries Axiom V3 token values directly (inverse surface, borders, focus ring).
 */
export const PILL_CSS = `
:host { all: initial; }
.wrap {
  position: fixed; left: 12px; bottom: 12px; z-index: 2147483000;
  display: grid; gap: 8px; justify-items: start;
  color-scheme: light dark;
  font-family: "Die Grotesk B", "DI Grotesk B", "Roboto Variable", Roboto, system-ui, sans-serif;
  font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: .015em;
}
p { margin: 0; }
.pill {
  display: inline-flex; align-items: center; gap: 8px;
  height: 32px; max-width: min(380px, calc(100vw - 24px)); padding: 0 4px 0 12px;
  border-radius: 9999px;
  background: light-dark(#252825, #F9FCF8); color: light-dark(#FFFFFF, #202320);
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / .1), 0 2px 4px -2px rgb(0 0 0 / .1);
}
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0; border: 0; background: none; color: inherit; cursor: pointer;
  font: inherit; letter-spacing: inherit;
}
.icon-btn {
  flex: none; display: grid; place-items: center; width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: 9999px; background: transparent; color: inherit; opacity: .8; cursor: pointer;
}
.icon-btn:hover { opacity: 1; background: light-dark(#FFFFFF24, #20232014); }
.icon-btn svg { width: 16px; height: 16px; }
.hint {
  padding: 4px 8px; border-radius: 6px; font-weight: 400;
  background: light-dark(#252825, #F9FCF8); color: light-dark(#FFFFFF, #202320);
}
.hint[hidden] { display: none; }
.card {
  position: relative; display: grid; gap: 8px;
  width: min(340px, calc(100vw - 24px)); padding: 12px 40px 12px 16px;
  border: 1px solid light-dark(#D8E4CB, #484E46); border-radius: 12px;
  background: light-dark(#FFFFFF, #2B2E2B); color: light-dark(#202320, #D2DEC2);
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1);
  font-size: 14px; line-height: 20px; font-weight: 400;
}
.title strong { font-weight: 500; overflow-wrap: anywhere; }
.text { font-size: 12px; line-height: 16px; color: light-dark(#484E46, #B2BD9E); overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.btn {
  height: 24px; padding: 0 8px; cursor: pointer;
  border: 1px solid light-dark(#D8E4CB, #484E46); border-radius: 8px;
  background: light-dark(#FFFFFF, #2B2E2B); color: inherit;
  font-family: inherit; font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: inherit;
}
.btn:hover { background: light-dark(#F1F6EC, #333633); }
.btn.subtle { border-color: transparent; background: transparent; }
.btn.subtle:hover { background: light-dark(#F1F6EC, #333633); }
.close { position: absolute; top: 8px; right: 8px; color: light-dark(#484E46, #B2BD9E); }
.close:hover { background: light-dark(#F1F6EC, #333633); }
:focus-visible { outline: 2px solid light-dark(#197A94, #409AAB); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) {
  .pill, .card { animation: enter 150ms ease-out; }
  @keyframes enter { from { opacity: 0; transform: translateY(4px); } }
}
`;
