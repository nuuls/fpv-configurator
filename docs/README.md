# Specs

The source of truth for **what** the app does. Code follows the spec; when they disagree, fix one of them
in the same change.

```
docs/
  SPEC.md            product-level: audience, scope, layout, global behaviour
  tabs/
    _TEMPLATE.md     copy this for every new tab
    <tab>.md         one file per tab, same name as the route (src/routes.ts)
  refs/              screenshots, sketches, photos referenced from the specs
```

## Format rules

- **Keep it short.** Bullets and tables, not prose. `SPEC.md` ≤ 1–2 pages, a tab spec ≤ 1 page.
- **Write decisions, not wishes.** "Saves on explicit button press" — not "saving should be intuitive".
- **Unknown is fine, silent is not.** Anything undecided goes under _Open questions_ as a `- [ ]` item.
  Nothing with open questions gets built.
- **`Status:` line at the top of every tab spec** — one of `placeholder` · `draft` · `ready` · `built`.
  Only `ready` tabs get implemented; set `built` when the acceptance checklist passes.
- **Say what's left out.** Every tab lists what it deliberately hides compared to Betaflight Configurator.
- **Name things the Betaflight way.** Use the CLI setting name (`motor_pwm_protocol`) or MSP message
  (`MSP_RC`) for every control, so the mapping to firmware is unambiguous.
- **Acceptance = things checkable with the mock FC.** "Connect Mock FC → move X → see Y."
- Text in _italics_ inside the files is guidance — replace or delete it.
