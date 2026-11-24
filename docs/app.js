// Budget — suivi des dépenses à partir des exports CSV BoursoBank (local-only PWA)
// Aucune connexion à la banque : les opérations viennent du fichier exporté, et restent sur l'appareil.

/* ---------------------------------------------------------------- utils */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const eur = (x, dec = 0) => (x ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec, maximumFractionDigits: dec });
const eur2 = (x) => eur(x, 2);
const pct = (x) => `${Math.round(x * 100)} %`;
const monthKey = (d) => d.slice(0, 7);
const curMonth = () => new Date().toLocaleDateString('sv-SE').slice(0, 7);
const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthName = (m, short) => new Date(m + '-15T12:00:00').toLocaleDateString('fr-FR', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
const dayLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------------------------------------------------------- store */
const STORE_KEY = 'budget.v1';
const defaults = () => ({
  tx: [], rules: {}, budgets: {}, savingsGoal: 300,
  excluded: ['Mouvements internes', 'Virements internes', 'Épargne'],
  lastImport: null,
});
let db = (() => { try { return { ...defaults(), ...JSON.parse(localStorage.getItem(STORE_KEY)) }; } catch { return defaults(); } })();
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch { toast('Stockage plein : fais une sauvegarde'); } };
navigator.storage?.persist?.();

/* ---------------------------------------------------------------- categories */
// Fallback rules when the bank file has no category. Order matters (first match wins).
const KEYWORD_RULES = [
  ['Mouvements internes', /vir(ement)? (interne|vers|de) (mon|livret|compte)|virement interne|vers livret|livret a|ldds|pea /],
  ['Revenus', /salaire|paie|remuneration|caf |allocation|pole emploi|france travail|remboursement|virement de /],
  ['Alimentation', /carrefour|leclerc|lidl|auchan|intermarche|monoprix|franprix|picard|biocoop|casino|aldi|super u|hyper u|netto|grand frais|naturalia|la vie claire|marche|boulangerie|primeur/],
  ['Restaurants & livraison', /uber ?eats|deliveroo|just ?eat|mcdo|mc donald|burger|kfc|quick|subway|restaurant|resto|pizza|sushi|starbucks|brasserie|cafe |bar /],
  ['Abonnements', /netflix|spotify|deezer|disney|canal|amazon prime|prime video|apple\.com|icloud|youtube|google one|chatgpt|openai|anthropic|claude|playstation plus|xbox game|crunchyroll/],
  ['Téléphone & internet', /free mobile|free telecom|orange|sfr|bouygues|sosh|red by|b&you|la poste mobile/],
  ['Sport', /basic ?fit|fitness park|on air|keepcool|l'orange bleue|neoness|salle de sport|decathlon|myprotein|nutrimuscle|prozis|bulk/],
  ['Transports', /sncf|ouigo|ratp|navigo|uber(?! ?eats)|bolt|blablacar|total|esso|shell|bp |avia|carburant|peage|vinci|autoroute|parking|lime|tier/],
  ['Shopping', /amazon|fnac|darty|zara|h&m|uniqlo|shein|vinted|cdiscount|leboncoin|ikea|action|primark|sephora|nike|adidas/],
  ['Loisirs', /steam|epic games|riot|blizzard|battle\.net|ubisoft|nintendo|cinema|ugc|pathe|gaumont|fnac spectacles|ticketmaster|concert/],
  ['Santé', /pharmacie|doctolib|medecin|dentiste|kine|opticien|mutuelle|hopital|laboratoire/],
  ['Logement', /loyer|edf|engie|total energies|eau |veolia|suez|assurance habitation|syndic|taxe fonciere/],
  ['Retraits', /retrait|dab /],
  ['Impôts & taxes', /dgfip|impot|finances publiques|amende|urssaf/],
  ['Banque', /cotisation|frais|commission|agios|boursobank|boursorama/],
];
const ESSENTIAL = /logement|sante|impot|banque|assurance|loyer|particuliers/; // not suggested for cuts or listed as subscriptions

// Transfers to / from private individuals (friends, family, Lydia, Wero…), in both directions.
// The bank file usually files them under a generic "virements" category, so they are detected from the label.
const P2P = 'Virements entre particuliers';
const P2P_APPS = /\b(lydia|sumeria|paylib|wero|pumpkin)\b/;
const NOT_PERSON = /\b(salaire|paie|prime|sas|sasu|sarl|sa|eurl|sci|scp|snc|ste|societe|ets|cie|group|groupe|caf|cpam|ameli|urssaf|dgfip|tresor|finances|impots?|travail|emploi|assurances?|mutuelle|banque|bank|boursobank|boursorama|livret|ldds|lep|pea|epargne|compte|loyer|edf|engie|association|asso|mairie|universite|ecole|notaire|cabinet|agence|syndic)\b/;
const PERSON_PREFIX = /^(?:(?:de|vers|a|pour|from|to|recu|emis)\s+)*(?:(?:m|mr|mme|mlle|monsieur|madame|mrs|ms)\.?\s+)?/;
const p2pCache = new Map();
function isP2P(t) {
  if (t.biz) return false; // the bank recognised a business
  if (p2pCache.has(t.id)) return p2pCache.get(t.id);
  const n = norm(t.label).replace(/[.,/]/g, ' ').replace(/\s+/g, ' ');
  let r = false;
  if (P2P_APPS.test(n)) r = true;
  else if (!KEYWORD_RULES[0][1].test(n) && !NOT_PERSON.test(n)
    && (!t.catBank || /virement|mouvement|autre|divers|revenu|non categ/.test(norm(t.catBank)))) {
    const m = n.match(/^vir(?:ement)?s?(?:\s+(?:sepa|inst|instantane|permanent|recu|emis))*\s+(.+)$/);
    // a person looks like "jean dupont" / "m jean dupont": at least two words of letters, optionally followed by a note
    const words = m ? m[1].replace(PERSON_PREFIX, '').split(' ') : [];
    r = words.length >= 2 && words.slice(0, 2).every((w) => /^[a-z][a-z'-]+$/.test(w));
  }
  p2pCache.set(t.id, r);
  return r;
}
const catOf = (t) => db.rules[t.merchant] || t.catUser || (isP2P(t) ? P2P : t.catBank || t.catAuto) || 'Autres';
const isExcluded = (cat) => db.excluded.some((e) => norm(e) === norm(cat));

function cleanMerchant(label) {
  let s = ' ' + label + ' ';
  s = s.replace(/\b(CARTE|CB|PAIEMENT PAR CARTE|PRLV SEPA|PRELEVEMENT|VIR SEPA|VIR INST|VIREMENT|AVOIR|RETRAIT DAB)\b/gi, ' ')
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, ' ').replace(/\bX?\d{4,}\b/g, ' ').replace(/\*/g, ' ')
    .replace(/\b(FR|PARIS|LYON|MARSEILLE)\b\s*$/i, ' ').replace(/\s{2,}/g, ' ').trim();
  return cap(s.toLowerCase()).slice(0, 40) || label.slice(0, 40);
}
const autoCat = (label, amount) => {
  const n = norm(label);
  for (const [cat, re] of KEYWORD_RULES) if (re.test(n)) return cat;
  return amount > 0 ? 'Revenus' : null;
};

/* ---------------------------------------------------------------- CSV import */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}
const parseAmount = (s) => {
  if (s == null) return null; let t = String(s).replace(/[\s  €]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t); return Number.isFinite(n) ? n : null;
};
const parseDate = (s) => {
  s = String(s ?? '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
};
// Column finder: BoursoBank exports use dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance
function mapColumns(header) {
  const h = header.map(norm);
  const find = (...names) => h.findIndex((x) => names.some((n) => x === n || x.replace(/[^a-z]/g, '') === n.replace(/[^a-z]/g, '')));
  const findIn = (re) => h.findIndex((x) => re.test(x));
  return {
    date: find('dateop', 'date operation', 'date'), dateVal: find('dateval', 'date valeur'),
    label: find('label', 'libelle', 'libelle operation', 'description'),
    cat: find('category', 'categorie', 'sous categorie'), catParent: find('categoryparent', 'categorie parent', 'categorie principale'),
    supplier: find('supplierfound', 'fournisseur', 'marchand'),
    amount: find('amount', 'montant', 'montant eur'), debit: findIn(/^debit/), credit: findIn(/^credit/),
    account: find('accountnum', 'numero de compte', 'compte'), accountLabel: find('accountlabel', 'libelle compte'),
  };
}
function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Fichier vide');
  const col = mapColumns(rows[0]);
  if (col.date < 0 || col.label < 0 || (col.amount < 0 && col.debit < 0)) throw new Error('Colonnes non reconnues');
  const seen = new Map(db.tx.map((t) => [t.id, true]));
  const counts = {}; let added = 0, dup = 0, bad = 0;
  for (const r of rows.slice(1)) {
    const date = parseDate(r[col.date]) || parseDate(r[col.dateVal]);
    let amount = col.amount >= 0 ? parseAmount(r[col.amount]) : (parseAmount(r[col.credit]) || 0) - Math.abs(parseAmount(r[col.debit]) || 0);
    const label = (r[col.label] || '').replace(/\s+/g, ' ').trim();
    if (!date || amount == null || !label) { bad++; continue; }
    const account = (col.account >= 0 && r[col.account]) || (col.accountLabel >= 0 && r[col.accountLabel]) || '';
    // same operation can legitimately appear twice the same day: number occurrences
    const base = `${date}|${label}|${amount.toFixed(2)}|${account}`; counts[base] = (counts[base] || 0) + 1;
    const id = hash(base + '|' + counts[base]);
    if (seen.has(id)) { dup++; continue; }
    const supplier = col.supplier >= 0 ? (r[col.supplier] || '').trim() : '';
    const catBank = ((col.catParent >= 0 && r[col.catParent]) || (col.cat >= 0 && r[col.cat]) || '').trim();
    const t = { id, date, label, amount: Math.round(amount * 100) / 100, account, merchant: supplier ? cap(supplier.toLowerCase()) : cleanMerchant(label), ...(supplier && { biz: true }),
      catBank: catBank && !/^(non categorise|a categoriser|autres?)$/i.test(norm(catBank)) ? catBank : null, catAuto: autoCat(label, amount) };
    db.tx.push(t); seen.set(id, true); added++;
  }
  db.tx.sort((a, b) => b.date.localeCompare(a.date));
  db.lastImport = new Date().toISOString(); save();
  return { added, dup, bad };
}

/* ---------------------------------------------------------------- analytics */
const counted = (t) => !isExcluded(catOf(t));
const txOfMonth = (m) => db.tx.filter((t) => monthKey(t.date) === m && counted(t));
function monthStats(m) {
  const tx = txOfMonth(m);
  const income = tx.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const spent = -tx.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);
  const byCat = {}, byMerchant = {};
  for (const t of tx) if (t.amount < 0) {
    const c = catOf(t); byCat[c] = (byCat[c] || 0) - t.amount;
    byMerchant[t.merchant] = byMerchant[t.merchant] || { sum: 0, n: 0, cat: c }; byMerchant[t.merchant].sum -= t.amount; byMerchant[t.merchant].n++;
  }
  return { tx, income, spent, saved: income - spent, byCat, byMerchant };
}
const months = () => [...new Set(db.tx.map((t) => monthKey(t.date)))].sort();
function avgPrev(m, n = 3) {
  const res = {}; let k = 0;
  for (let i = 1; i <= n; i++) {
    const mm = addMonths(m, -i); if (!db.tx.some((t) => monthKey(t.date) === mm)) continue; k++;
    for (const [c, v] of Object.entries(monthStats(mm).byCat)) res[c] = (res[c] || 0) + v;
  }
  if (k) for (const c in res) res[c] /= k;
  return { avg: res, n: k };
}
function subscriptions() {
  const last = curMonthWithData(); const from = addMonths(last, -5);
  const groups = {};
  for (const t of db.tx) if (t.amount < 0 && monthKey(t.date) >= from && counted(t) && !ESSENTIAL.test(norm(catOf(t)))) (groups[t.merchant] ||= []).push(t);
  const subs = [];
  for (const [merchant, list] of Object.entries(groups)) {
    const byMonth = {}; list.forEach((t) => { (byMonth[monthKey(t.date)] ||= []).push(-t.amount); });
    const ms = Object.keys(byMonth); if (ms.length < 3) continue;
    const amounts = ms.map((m) => byMonth[m].reduce((a, b) => a + b, 0)); const med = median(amounts);
    if (med <= 0 || amounts.some((a) => Math.abs(a - med) / med > 0.15)) continue;
    if (Object.values(byMonth).some((a) => a.length > 2)) continue; // too frequent: shopping, not a subscription
    subs.push({ merchant, monthly: med, cat: catOf(list[0]), months: ms.length, last: list[0].date });
  }
  return subs.sort((a, b) => b.monthly - a.monthly);
}
const curMonthWithData = () => months().at(-1) || curMonth();

/* ---------------------------------------------------------------- state & render */
const state = { tab: 'month', month: null, opQuery: '', opCat: null };
const view = $('#view');
const bar = (f, color) => `<div class="bar"><span style="width:${clamp(f, 0, 1) * 100}%;background:${color}"></span></div>`;
const icons = {
  up: '<svg viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 9v8H9"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  piggy: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M15 9.2a3.6 3.6 0 1 0 0 5.6M7.5 11h5.5M7.5 13.2h5.5"/></svg>',
  store: '<svg viewBox="0 0 24 24"><path d="M3 9l1.5-5h15L21 9M4 9v11h16V9M9 20v-6h6v6"/></svg>',
};

function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => (b.dataset.tab === state.tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  state.month ||= curMonthWithData();
  view.innerHTML = db.tx.length || state.tab === 'settings' ? { month: renderMonth, ops: renderOps, save: renderSave, settings: renderSettings }[state.tab]() : renderEmpty();
}

function renderEmpty() {
  return `<header class="head"><div><h1>Budget</h1><div class="sub">Tes dépenses BoursoBank, en clair</div></div></header>
  <section class="card glass">
    <div class="dropzone">
      <p style="margin:0 0 14px;font-weight:600">Importe ton premier relevé</p>
      <button class="pill primary" data-act="import">Choisir le fichier CSV</button>
      <p class="muted" style="font-size:14px;margin:14px 0 0">Tout reste sur ton iPhone. Aucun identifiant bancaire n'est demandé.</p>
    </div>
  </section>
  ${helpCard()}`;
}
const helpCard = () => `<section class="card glass help">
    <h2>Exporter depuis BoursoBank</h2>
    <ol>
      <li>Va sur <b>boursobank.com</b> dans Safari (version ordinateur si besoin : <b>aA → Site pour ordinateur</b>) et connecte-toi.</li>
      <li>Ouvre ton <b>compte courant</b>, puis <b>Exporter les opérations</b> (icône de téléchargement au-dessus de la liste).</li>
      <li>Choisis le format <b>CSV</b> et une période (par exemple les 6 derniers mois), puis télécharge.</li>
      <li>Dans Budget : <b>Importer</b> → le fichier est dans <b>Fichiers → Téléchargements</b>.</li>
    </ol>
    <p class="muted" style="margin:0;font-size:14px">Réimporter un relevé qui chevauche le précédent ne crée pas de doublons. Si le bouton a changé de place chez BoursoBank, cherche « Exporter » ou « Télécharger ».</p>
  </section>`;

function monthNav(m) {
  const ms = months(); const i = ms.indexOf(m);
  return `<div class="daynav">
    <button class="pill icon" data-act="month" data-m="${ms[i - 1] || ''}" ${i <= 0 ? 'disabled' : ''} aria-label="Mois précédent"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
    <button class="pill icon" data-act="month" data-m="${ms[i + 1] || ''}" ${i < 0 || i >= ms.length - 1 ? 'disabled' : ''} aria-label="Mois suivant"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
  </div>`;
}

function renderMonth() {
  const m = state.month; const s = monthStats(m); const { avg, n } = avgPrev(m);
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  const merchants = Object.entries(s.byMerchant).sort((a, b) => b[1].sum - a[1].sum).slice(0, 5);
  const rate = s.income > 0 ? s.saved / s.income : null;
  const goal = db.savingsGoal || 0;
  // 12-month history
  const hist = Array.from({ length: 12 }, (_, i) => addMonths(m, i - 11));
  const hs = hist.map((mm) => ({ m: mm, ...monthStats(mm) }));
  const hmax = Math.max(1, ...hs.map((h) => Math.max(h.income, h.spent)));
  const partial = m === curMonth();
  // Current month is incomplete: compare with the usual pace at the same day of the month
  const [yy, mm0] = m.split('-').map(Number);
  const frac = partial ? new Date().getDate() / new Date(yy, mm0, 0).getDate() : 1;

  return `
  <header class="head"><div><h1>${esc(cap(monthName(m)))}</h1><div class="sub">${partial ? 'Mois en cours · ' : ''}${s.tx.length} opérations</div></div>${monthNav(m)}</header>

  <section class="card glass">
    <div class="muted" style="font-size:14px">Dépensé</div>
    <div class="hero-num num">${eur(s.spent)}</div>
    <div class="trio num">
      <div><div class="lbl"><span class="dot" style="background:var(--inc)"></span>Revenus</div><div class="val">${eur(s.income)}</div></div>
      <div><div class="lbl"><span class="dot" style="background:var(--exp)"></span>Dépenses</div><div class="val">${eur(s.spent)}</div></div>
      <div><div class="lbl">Épargné</div><div class="val ${s.saved >= 0 ? 'pos' : 'neg'}">${s.saved >= 0 ? '+' : ''}${eur(s.saved)}</div></div>
    </div>
    ${goal ? `<div class="macro" style="margin-top:16px"><div class="top"><span class="name">Objectif d'épargne</span><span class="num">${eur(Math.max(0, s.saved))} / ${eur(goal)}</span></div>
      ${bar(Math.max(0, s.saved) / goal, s.saved >= goal ? 'var(--good)' : 'var(--accent)')}
      <div class="faint" style="font-size:12px;margin-top:6px">${rate != null ? `Taux d'épargne : ${pct(rate)} des revenus` : 'Pas de revenus ce mois-ci'}</div></div>` : ''}
  </section>

  <section class="card glass">
    <h2>Où part ton argent <span class="meta">${n ? (partial ? 'vs ton rythme habituel' : `vs moyenne ${n} mois`) : ''}</span></h2>
    ${cats.length ? cats.map(([c, v]) => {
      const a = avg[c] ? avg[c] * frac : null; const d = a && a > 5 ? (v - a) / a : null;
      return `<div class="hrow" data-act="cat" data-c="${esc(c)}" role="button" tabindex="0">
        <span class="t">${esc(c)}</span><span class="v num">${eur(v)}</span>
        ${bar(v / max, 'var(--exp)')}
        <span class="s num"><span>${pct(v / (s.spent || 1))} des dépenses</span>${d != null && Math.abs(d) >= 0.1 ? `<span class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${Math.round(d * 100)} % ${partial ? 'vs d’habitude à cette date' : 'vs moyenne'}</span>` : '<span></span>'}</span>
      </div>`;
    }).join('') : '<p class="muted" style="margin:0">Aucune dépense ce mois-ci.</p>'}
  </section>

  ${merchants.length ? `<section class="card glass"><h2>Top marchands</h2><ul class="list">
    ${merchants.map(([name, x]) => `<li><div class="grow"><div class="t">${esc(name)}</div><div class="s">${esc(x.cat)} · ${x.n} achat${x.n > 1 ? 's' : ''}</div></div><b class="num">${eur(x.sum)}</b></li>`).join('')}
  </ul></section>` : ''}

  <section class="card glass">
    <h2>12 derniers mois</h2>
    <div class="cols" role="img" aria-label="Revenus et dépenses par mois">
      ${hs.map((h) => `<div class="pair" data-act="month" data-m="${h.m}" ${h.m === m ? 'aria-current="true"' : ''} title="${esc(cap(monthName(h.m)))} : revenus ${eur(h.income)}, dépenses ${eur(h.spent)}">
        <span style="height:${(h.income / hmax) * 100}%;background:var(--inc)"></span><span style="height:${(h.spent / hmax) * 100}%;background:var(--exp)"></span></div>`).join('')}
    </div>
    <div class="row between faint" style="font-size:11px;margin-top:6px"><span>${esc(monthName(hist[0], true))}</span><span>${esc(monthName(hist.at(-1), true))}</span></div>
    <div class="legend"><span><span class="dot" style="background:var(--inc)"></span>Revenus</span><span><span class="dot" style="background:var(--exp)"></span>Dépenses</span></div>
    <ul class="list" style="margin-top:8px">${hs.slice(-6).reverse().filter((h) => h.tx.length).map((h) => `<li><span class="grow">${esc(cap(monthName(h.m)))}</span><span class="num muted">${eur(h.spent)}</span><b class="num ${h.saved >= 0 ? 'pos' : 'neg'}" style="min-width:80px;text-align:right">${h.saved >= 0 ? '+' : ''}${eur(h.saved)}</b></li>`).join('')}</ul>
  </section>`;
}

function renderOps() {
  const q = norm(state.opQuery);
  const list = db.tx.filter((t) => (!state.opCat || catOf(t) === state.opCat) && (!q || norm(t.label + ' ' + t.merchant + ' ' + catOf(t)).includes(q))).slice(0, 300);
  const cats = [...new Set(db.tx.map(catOf))].sort((a, b) => a.localeCompare(b, 'fr'));
  let lastDay = '';
  return `
  <header class="head"><div><h1>Opérations</h1><div class="sub">${db.tx.length} au total</div></div><button class="pill" data-act="import">Importer</button></header>
  <input class="input" type="search" placeholder="Rechercher (marchand, libellé…)" data-act-input="opq" value="${esc(state.opQuery)}" style="margin-bottom:10px">
  <div class="chips" style="margin-bottom:12px"><button class="chip" data-act="opcat" data-c="" aria-pressed="${!state.opCat}">Toutes</button>
    ${cats.map((c) => `<button class="chip" data-act="opcat" data-c="${esc(c)}" aria-pressed="${state.opCat === c}">${esc(c)}</button>`).join('')}</div>
  <section class="card glass">
    ${list.length ? list.map((t) => {
      const sep = t.date !== lastDay ? `<div class="daysep">${esc(cap(dayLabel(t.date)))}</div>` : ''; lastDay = t.date;
      return `${sep}<div class="row" style="padding:9px 2px;border-top:1px solid var(--line);cursor:pointer" data-act="op" data-id="${t.id}" role="button" tabindex="0">
        <div class="grow"><div class="t" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.merchant)}</div>
        <div class="s" style="font-size:13px;color:var(--ink-2)">${esc(catOf(t))}${isExcluded(catOf(t)) ? ' · non compté' : ''}</div></div>
        <span class="op-amt num ${t.amount > 0 ? 'pos' : ''}">${t.amount > 0 ? '+' : ''}${eur2(t.amount)}</span></div>`;
    }).join('') : '<p class="muted" style="margin:0">Aucune opération.</p>'}
    ${list.length === 300 ? '<p class="faint" style="font-size:13px">Affiche les 300 plus récentes : affine la recherche.</p>' : ''}
  </section>`;
}

function renderSave() {
  const m = state.month; const s = monthStats(m);
  // reference month: last complete month when the current one is partial
  const refM = m === curMonth() && months().includes(addMonths(m, -1)) ? addMonths(m, -1) : m;
  const ref = monthStats(refM); const { avg } = avgPrev(addMonths(refM, 1), 3);
  const subs = subscriptions(); const subTotal = subs.reduce((a, x) => a + x.monthly, 0);
  const cuts = Object.entries(avg).filter(([c]) => !ESSENTIAL.test(norm(c)) && !/revenus|retraits/i.test(c)).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const prevAvg = avgPrev(refM).avg;
  const rising = Object.entries(ref.byCat).map(([c, v]) => [c, v, prevAvg[c]]).filter(([, v, a]) => a && v > a * 1.25 && v - a > 20).sort((a, b) => (b[1] - b[2]) - (a[1] - a[2])).slice(0, 3);
  const budgets = Object.entries(db.budgets).filter(([, v]) => v > 0);

  return `
  <header class="head"><div><h1>Économies</h1><div class="sub">Où et comment mettre de côté</div></div></header>

  <section class="card glass">
    <h2>Pistes concrètes</h2>
    ${cuts.length ? cuts.map(([c, v]) => `<div class="insight"><div class="ico" style="color:var(--good)">${icons.piggy}</div>
      <div><b>${esc(c)}</b> : ${eur(v)} par mois en moyenne. En réduisant de 20 %, tu gardes <b class="pos">${eur(v * 0.2)}/mois</b>, soit <b class="pos">${eur(v * 0.2 * 12)}/an</b>.</div></div>`).join('')
      : '<p class="muted" style="margin:0">Importe au moins un mois complet pour obtenir des pistes.</p>'}
    ${rising.map(([c, v, a]) => `<div class="insight"><div class="ico" style="color:#ff6961">${icons.up}</div>
      <div><b>${esc(c)}</b> a grimpé en ${esc(monthName(refM, true))} : ${eur(v)} contre ${eur(a)} d'habitude (<span class="neg">+${eur(v - a)}</span>).</div></div>`).join('')}
    ${subs.length ? `<div class="insight"><div class="ico" style="color:var(--warn)">${icons.repeat}</div>
      <div><b>${subs.length} abonnement${subs.length > 1 ? 's' : ''}</b> détecté${subs.length > 1 ? 's' : ''} : ${eur(subTotal)}/mois, soit <b>${eur(subTotal * 12)}/an</b>. Fais le tri dans ceux que tu n'utilises plus.</div></div>` : ''}
  </section>

  <section class="card glass">
    <h2>Abonnements <span class="meta">${subs.length ? eur(subTotal) + '/mois' : ''}</span></h2>
    ${subs.length ? `<ul class="list">${subs.map((x) => `<li><div class="grow"><div class="t">${esc(x.merchant)}</div><div class="s">${esc(x.cat)} · ${x.months} mois de suite</div></div><b class="num">${eur2(x.monthly)}</b></li>`).join('')}</ul>`
      : '<p class="muted" style="margin:0">Aucun paiement régulier détecté (il faut au moins 3 mois d\'historique).</p>'}
  </section>

  <section class="card glass">
    <h2>Budgets mensuels <button class="pill small" data-act="budgets">Modifier</button></h2>
    ${budgets.length ? budgets.map(([c, b]) => { const v = s.byCat[c] || 0; const over = v > b;
      return `<div class="macro"><div class="top"><span class="name">${esc(c)}</span><span class="num ${over ? 'neg' : ''}">${eur(v)} / ${eur(b)}</span></div>
        ${bar(v / b, over ? 'var(--bad)' : v > b * 0.8 ? 'var(--warn)' : 'var(--accent)')}</div>`; }).join('')
      : '<p class="muted" style="margin:0">Fixe un plafond par catégorie (restos, shopping…) pour voir où tu en es dans le mois.</p>'}
  </section>`;
}

function renderSettings() {
  const cats = [...new Set([...db.tx.map(catOf), ...db.excluded])].sort((a, b) => a.localeCompare(b, 'fr'));
  const rules = Object.entries(db.rules);
  return `
  <header class="head"><div><h1>Réglages</h1><div class="sub">${db.lastImport ? 'Dernier import : ' + new Date(db.lastImport).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : 'Aucun import'}</div></div></header>
  <section class="card glass">
    <h2>Relevés</h2>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="pill primary" data-act="import">Importer un CSV</button></div>
  </section>
  ${helpCard()}
  <section class="card glass">
    <h2>Objectif d'épargne</h2>
    <label class="field"><span>Montant à mettre de côté chaque mois (€)</span><input class="input num" inputmode="decimal" data-set="savingsGoal" value="${db.savingsGoal || ''}"></label>
  </section>
  <section class="card glass">
    <h2>Catégories non comptées</h2>
    <p class="muted" style="margin-top:0;font-size:14px">Les virements entre tes comptes (vers ton livret, ton PEA…) ne sont ni des dépenses ni des revenus. Coche celles à ignorer.</p>
    ${cats.map((c) => `<label class="row between" style="padding:8px 2px;border-top:1px solid var(--line)"><span>${esc(c)}</span><input type="checkbox" data-excl="${esc(c)}" ${isExcluded(c) ? 'checked' : ''} style="width:22px;height:22px"></label>`).join('')}
  </section>
  ${rules.length ? `<section class="card glass"><h2>Mes règles</h2><ul class="list">${rules.map(([mch, c]) => `<li><div class="grow"><div class="t">${esc(mch)}</div><div class="s">→ ${esc(c)}</div></div><button class="pill small danger" data-act="del-rule" data-m="${esc(mch)}">Retirer</button></li>`).join('')}</ul></section>` : ''}
  <section class="card glass">
    <h2>Mes données</h2>
    <p class="muted" style="margin-top:0;font-size:14px">Tes opérations restent sur cet iPhone. Sauvegarde-les de temps en temps (Fichiers / iCloud Drive).</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="pill" data-act="export">Sauvegarder</button>
      <label class="pill" style="display:inline-block">Restaurer<input type="file" accept="application/json" data-act-change="restore" class="sr"></label>
      <button class="pill danger" data-act="wipe">Tout effacer</button>
    </div>
  </section>`;
}

/* ---------------------------------------------------------------- sheets */
function openSheet(html) {
  closeSheet();
  const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet glass" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
  $('#sheet-root').append(wrap); document.body.style.overflow = 'hidden';
  return wrap.firstElementChild;
}
function closeSheet() { $('#sheet-root').innerHTML = ''; document.body.style.overflow = ''; }

function opSheet(t) {
  const cats = [...new Set([...db.tx.map(catOf), ...KEYWORD_RULES.map((r) => r[0]), P2P, 'Autres'])].sort((a, b) => a.localeCompare(b, 'fr'));
  const sheet = openSheet(`
    <h2>${esc(t.merchant)}</h2>
    <dl class="kv num"><dt>Montant</dt><dd class="${t.amount > 0 ? 'pos' : ''}">${eur2(t.amount)}</dd><dt>Date</dt><dd>${esc(dayLabel(t.date))}</dd>${t.account ? `<dt>Compte</dt><dd>${esc(t.account)}</dd>` : ''}</dl>
    <p class="faint" style="font-size:13px;word-break:break-word">${esc(t.label)}</p>
    <label class="field"><span>Catégorie</span><input class="input" list="catlist" data-c value="${esc(catOf(t))}"></label>
    <datalist id="catlist">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <label class="row between" style="margin:0 4px"><span>Toujours pour « ${esc(t.merchant)} »</span><input type="checkbox" data-always checked style="width:22px;height:22px"></label>
    <div class="actions"><button class="pill" data-a="cancel">Annuler</button><button class="pill primary" data-a="ok">Enregistrer</button></div>`);
  sheet.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'cancel') return closeSheet();
    const c = $('[data-c]', sheet).value.trim(); if (!c) return toast('Choisis une catégorie');
    if ($('[data-always]', sheet).checked) db.rules[t.merchant] = c; else { delete db.rules[t.merchant]; t.catUser = c; }
    save(); closeSheet(); render(); toast('Catégorie mise à jour');
  });
}
function budgetsSheet() {
  const avg = avgPrev(addMonths(curMonthWithData(), 1), 3).avg;
  const cats = [...new Set([...Object.keys(avg), ...Object.keys(db.budgets)])].filter((c) => !isExcluded(c) && !/revenus/i.test(c)).sort((a, b) => (avg[b] || 0) - (avg[a] || 0));
  const sheet = openSheet(`
    <h2>Budgets mensuels</h2>
    <p class="muted" style="margin-top:0;font-size:14px">Plafond par mois. En gris : ta moyenne des 3 derniers mois.</p>
    ${cats.map((c) => `<label class="field"><span>${esc(c)} <span class="faint">· moy. ${eur(avg[c] || 0)}</span></span><input class="input num" inputmode="decimal" data-b="${esc(c)}" value="${db.budgets[c] || ''}" placeholder="${Math.round((avg[c] || 0) * 0.9 / 10) * 10 || ''}"></label>`).join('')}
    <div class="actions"><button class="pill" data-a="cancel">Annuler</button><button class="pill primary" data-a="ok">Enregistrer</button></div>`);
  sheet.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'ok') { sheet.querySelectorAll('[data-b]').forEach((i) => { const v = parseAmount(i.value); if (v > 0) db.budgets[i.dataset.b] = v; else delete db.budgets[i.dataset.b]; }); save(); render(); }
    closeSheet();
  });
}

/* ---------------------------------------------------------------- events */
document.querySelector('.tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { state.tab = b.dataset.tab; render(); scrollTo(0, 0); } });
$('#csv-input').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const buf = await f.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // older exports
    const r = importCSV(text);
    state.month = curMonthWithData(); state.tab = 'month'; render();
    toast(`${r.added} opération${r.added > 1 ? 's' : ''} ajoutée${r.added > 1 ? 's' : ''}${r.dup ? ` · ${r.dup} déjà présentes` : ''}`);
  } catch (err) { toast(err.message === 'Colonnes non reconnues' ? 'Ce fichier ne ressemble pas à un export BoursoBank' : 'Import impossible : ' + err.message); }
});
view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act;
  if (a === 'import') $('#csv-input').click();
  if (a === 'month' && el.dataset.m) { state.month = el.dataset.m; render(); }
  if (a === 'cat') { state.opCat = el.dataset.c; state.opQuery = ''; state.tab = 'ops'; render(); scrollTo(0, 0); }
  if (a === 'opcat') { state.opCat = el.dataset.c || null; render(); }
  if (a === 'op') opSheet(db.tx.find((t) => t.id === el.dataset.id));
  if (a === 'budgets') budgetsSheet();
  if (a === 'del-rule') { delete db.rules[el.dataset.m]; save(); render(); }
  if (a === 'export') {
    const blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `budget-sauvegarde-${new Date().toLocaleDateString('sv-SE')}.json` });
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }
  if (a === 'wipe') {
    const s = openSheet(`<h2>Tout effacer ?</h2><p class="muted">Toutes les opérations, règles et budgets de cet iPhone seront supprimés. Fais une sauvegarde avant si tu veux les garder.</p>
      <div class="actions"><button class="pill" data-a="no">Annuler</button><button class="pill danger" data-a="yes">Effacer</button></div>`);
    s.addEventListener('click', (ev) => { const b = ev.target.closest('[data-a]')?.dataset.a; if (b === 'yes') { db = defaults(); save(); state.month = null; render(); toast('Données effacées'); } if (b) closeSheet(); });
  }
});
view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[role=button]')) e.target.click(); });
view.addEventListener('input', (e) => {
  if (e.target.dataset.actInput === 'opq') { state.opQuery = e.target.value; const pos = e.target.selectionStart; render(); const i = $('[data-act-input=opq]'); i.focus(); i.setSelectionRange(pos, pos); }
});
view.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.set === 'savingsGoal') { db.savingsGoal = parseAmount(el.value) || 0; save(); }
  if (el.dataset.excl !== undefined) {
    const c = el.dataset.excl; db.excluded = db.excluded.filter((x) => norm(x) !== norm(c)); if (el.checked) db.excluded.push(c); save();
  }
  if (el.dataset.actChange === 'restore') {
    try {
      const data = JSON.parse(await el.files[0].text()); if (!Array.isArray(data.tx)) throw new Error();
      db = { ...defaults(), ...data }; save(); state.month = null; render(); toast('Sauvegarde restaurée');
    } catch { toast('Fichier de sauvegarde invalide'); }
  }
});

render();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
