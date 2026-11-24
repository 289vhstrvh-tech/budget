# Budget

Appli web (PWA) de suivi des dépenses, en français, pensée pour l'iPhone.
Les opérations viennent de l'export CSV de BoursoBank ; elles restent sur l'appareil (localStorage) et ne sont envoyées nulle part.
Aucun identifiant bancaire n'est demandé ni stocké.

## Développement

```
node tools/serve.mjs 5174              # http://localhost:5174
node tools/make-sample.mjs > tools/sample.csv   # faux relevé pour tester
```
