// Generates a FAKE BoursoBank-style CSV export (6 months) for testing. No real data.
// Usage: node tools/make-sample.mjs > sample.csv
const ops = [];
const add = (d, label, amount, cat = '', parent = '', supplier = '') => ops.push({ d, label, amount, cat, parent, supplier });
const now = new Date();
for (let k = 5; k >= 0; k--) {
  const y = new Date(now.getFullYear(), now.getMonth() - k, 1);
  const ym = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}`;
  const day = (d) => `${ym}-${String(d).padStart(2, '0')}`;
  const lastDay = k === 0 ? now.getDate() : 28;
  const r = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;
  add(day(1), 'VIR SEPA EXEMPLE EMPLOYEUR SALAIRE', 2150, 'Salaires', 'Revenus');
  add(day(2), 'PRLV SEPA LOYER EXEMPLE', -720, 'Loyer', 'Logement');
  add(day(3), 'VIR VERS LIVRET A', -200, 'Virements internes', 'Mouvements internes');
  add(day(5), 'PRLV SEPA FREE MOBILE', -19.99, 'Téléphone', 'Abonnements & téléphonie', 'Free mobile');
  add(day(6), 'CARTE 06/01 NETFLIX.COM', -13.49, 'Vidéo', 'Loisirs et sorties', 'Netflix');
  add(day(7), 'CARTE 07/01 SPOTIFY', -11.12, 'Musique', 'Loisirs et sorties', 'Spotify');
  add(day(8), 'PRLV SEPA BASIC FIT', -29.99, 'Sport', 'Loisirs et sorties', 'Basic fit');
  for (let d = 4; d <= lastDay; d += 3) add(day(d), `CARTE ${String(d).padStart(2, '0')}/01 CARREFOUR CITY`, -r(12, 48), 'Supermarché', 'Alimentation', 'Carrefour');
  for (let d = 5; d <= lastDay; d += 5) add(day(d), `CARTE ${String(d).padStart(2, '0')}/01 UBER EATS`, -r(14, 32) * (k === 1 ? 1.8 : 1), 'Restaurants', 'Restaurants, bars', 'Uber eats');
  add(day(12), 'CARTE 12/01 AMAZON EU SARL', -r(15, 90), 'Shopping', 'Achats & shopping', 'Amazon');
  add(day(14), 'CARTE 14/01 SNCF', -r(20, 60), 'Train', 'Transports', 'Sncf');
  add(day(16), 'CARTE 16/01 MYPROTEIN', -r(30, 55), '', '', '');
  add(day(18), 'CARTE 18/01 PHARMACIE CENTRALE', -r(5, 25), 'Pharmacie', 'Santé', 'Pharmacie');
  // transfers between private individuals, both directions (fake names)
  add(day(10), 'VIR SEPA M JEAN EXEMPLE', -r(20, 60), 'Virements émis', 'Mouvements internes');
  add(day(15), 'VIR INST MME CLAIRE TEST REMB RESTO', r(10, 40), 'Virements reçus', 'Revenus');
  add(day(22), 'VIREMENT LYDIA', -r(5, 30), '', '', '');
  if (k % 2) add(day(20), 'CARTE 20/01 STEAM GAMES', -r(10, 40), 'Jeux vidéo', 'Loisirs et sorties', 'Steam');
}
const fmt = (n) => n.toFixed(2).replace('.', ',');
const lines = ['dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance'];
for (const o of ops.sort((a, b) => b.d.localeCompare(a.d)))
  lines.push([o.d, o.d, `"${o.label}"`, `"${o.cat}"`, `"${o.parent}"`, `"${o.supplier}"`, `"${fmt(o.amount)}"`, '""', '00000000000', '"BOURSOBANK EXEMPLE"', '"1234,56"'].join(';'));
process.stdout.write('﻿' + lines.join('\n') + '\n');
