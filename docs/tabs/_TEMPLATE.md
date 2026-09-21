# <Tab name>

Status: placeholder
Route: `/<path>` · Page: `src/pages/<Name>.tsx`

## Purpose

_One sentence: what the user gets done here._

## Layout

_ASCII sketch, or `![sketch](../refs/<file>.png)`. Rough is fine — it shows grouping and order, not pixels._

```
+--------------------+--------------------+
| card               | card               |
+--------------------+--------------------+
```

## Controls

One row per thing the user can see or change.

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| _Receiver protocol_ | _select_ | _`serialrx_provider` · `MSP_RX_CONFIG`_ | _CRSF, SBUS, … · CRSF_ | _needs reboot_ |
| _Channel bars_ | _live readout_ | _`MSP_RC` @ 20 Hz_ | _1000–2000 µs_ | _read-only_ |

Type: `live readout` · `toggle` · `select` · `number` · `slider` · `button`.

## Behaviour

_Only what isn't obvious from the table or differs from SPEC.md §5._

- _Validation, dependencies between controls ("X only shown when Y is on")_
- _What happens on save; is a reboot needed_
- _Empty / error states (e.g. no receiver detected)_

## Hidden on purpose

_What Betaflight Configurator shows on its equivalent tab that this one doesn't — and the fixed value or
default used instead, if any._

- _…_

## Acceptance

Checkable with **Connect Mock FC** (so the mock has to support it):

- [ ] _…_

On real hardware:

- [ ] _…_

## Open questions

- [ ] _…_
