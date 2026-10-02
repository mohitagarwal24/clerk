// Tiny server-side HTML helpers. The mock apps deliberately look like a dated enterprise tool.

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Tagged template that escapes interpolations unless they are `raw()`. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? "");
  });
  return raw(out);
}

export class Raw { constructor(public readonly value: string) {} toString() { return this.value; } }
export const raw = (s: string) => new Raw(s);

function render(v: unknown): string {
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(v);
}

const BASE_CSS = `
body { font-family: Verdana, Tahoma, sans-serif; font-size: 12px; margin: 0; background: #eef1f5; color: #222; }
a { color: #0645ad; }
.top { padding: 8px 14px; color: #fff; display: flex; justify-content: space-between; align-items: center; }
.top b { font-size: 15px; }
.top a { color: #fff; }
nav { background: #dde3ea; border-bottom: 1px solid #aab4c0; padding: 6px 14px; }
nav a { margin-right: 14px; }
main { padding: 14px; max-width: 980px; }
h1 { font-size: 17px; margin: 4px 0 12px; }
table.grid { border-collapse: collapse; width: 100%; background: #fff; }
table.grid th, table.grid td { border: 1px solid #b9c2cc; padding: 5px 7px; text-align: left; }
table.grid th { background: #e4e9ef; }
td.num { text-align: right; font-family: "Courier New", monospace; }
.box { background: #fff; border: 1px solid #b9c2cc; padding: 12px; margin-bottom: 12px; }
.form-row { margin: 8px 0; }
.form-row label { display: inline-block; width: 150px; font-weight: bold; }
input[type=text], input[type=password], select, textarea { font: inherit; padding: 3px; border: 1px solid #8a96a3; width: 260px; }
button, input[type=submit] { font: inherit; padding: 4px 14px; border: 1px solid #555; background: linear-gradient(#fdfdfd, #dcdcdc); cursor: pointer; }
.err { background: #fde2e1; border: 1px solid #d9534f; color: #8a1f1b; padding: 8px; margin-bottom: 10px; }
.ok { background: #e2f3e2; border: 1px solid #4c9a4c; color: #245c24; padding: 8px; margin-bottom: 10px; }
.tag { display: inline-block; padding: 1px 6px; border: 1px solid #999; background: #f4f4f4; font-size: 11px; }
.tag.Superseded { background: #fff1c9; border-color: #c79a1a; }
.tag.Paid { background: #e2f3e2; border-color: #4c9a4c; }
.tag.Escalated { background: #fde2e1; border-color: #d9534f; }
.hint { color: #666; font-size: 11px; margin-left: 6px; }
.muted { color: #666; }
footer { color: #888; font-size: 10px; padding: 14px; }
`;

export function page(opts: { app: "portal" | "erp"; title: string; user?: string | null; nav?: Raw; body: Raw; status?: number }) {
  const brand = opts.app === "portal"
    ? { name: "Acme Corp Supplier Invoice Portal", color: "#2f5d50" }
    : { name: "Acme ERP 7.2  -  Accounts Payable", color: "#30466e" };
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${opts.title} - ${brand.name}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${raw(BASE_CSS)}</style></head>
<body>
<div class="top" style="background:${brand.color}"><b>${brand.name}</b>
${opts.user ? html`<span>Signed in as ${opts.user} | <form method="post" action="/${opts.app}/logout" style="display:inline"><button type="submit">Sign out</button></form></span>` : ""}
</div>
${opts.nav ?? ""}
<main>${opts.body}</main>
<footer>Acme Corp internal systems. Mock environment for the Clerk prototype.</footer>
</body></html>`.value;
}
