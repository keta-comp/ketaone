<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Offer in the shared dashboard navigation only the CRM entry points the tenant's preset keeps: `hiddenRoutesForPreset` (presets.ts) is the single switch for `hiddenCoreKeys`, so menu, links, dashboard tiles and page guards can never disagree. Still deduplicate configured module links and let navigation scroll independently so all sections stay reachable on short screens.
- Use TanStack Router's exported error props for route error components so their signatures follow the installed router contract.
- `crm_configs` rows are written from three places (`switchCrmPreset`, `syncPresetModules`, `updateCrmConfig`) and any scratch script that seeds one. Two schema facts make a wrong seed invisible until the admin sees a bare «Nimadir xato ketdi»: `industry` is **NOT NULL** (a `null` fails with 23502, whose quoted message `friendlyError` masks), and `config` is **jsonb that must hold an OBJECT** — binding `JSON.stringify(config)` under `$n::jsonb` double-encodes it, so `config->>'presetId'` reads back NULL and the tenant looks configured but empty. Always pass the object and verify with `jsonb_typeof(config)` after seeding; `pg-rest.server.ts` `writeValue()`/`jsonObjectOf()` unstrings a jsonb value so no caller can reintroduce it, and `presets.test.ts` pins the seed shape for every preset.
- The "Murojaatlar" (leads) section is out of the product: the page, Kanban components, quick-lead creation, nav key, preset opt-in and tiles are deleted, and `/dashboard/leads` sits permanently in `ALWAYS_HIDDEN_ROUTES` so no preset can re-enable it (presets.test.ts guards this). Conversion and KPIs are computed from orders instead. The `leads`/`lead_events`/`lead_assignments` tables stay — the Telegram/Instagram AI writer still records enquiries there and `notify_lead` still alerts staff, so inbound data is neither destroyed nor orphaned, and `payments.lead_id`/`orders.lead_id` FKs keep table drops unsafe.
